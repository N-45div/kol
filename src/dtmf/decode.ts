/**
 * DTMF decoder.
 *
 * Ground truth for the free fixture. CALL-E dials a phone, a laptop plays a synthetic menu
 * into it, and the laptop records the whole call. Whatever keys CALL-E pressed are in that
 * recording as dual-tone pairs, so we can read them out of the audio instead of asking the
 * model what it did — the same principle as the passphrase trick, applied to the keypad.
 *
 * Goertzel over the eight DTMF frequencies. Cheaper and far more selective than an FFT when
 * you only care about eight bins.
 */

const LOW = [697, 770, 852, 941] as const;
const HIGH = [1209, 1336, 1477, 1633] as const;

const KEYPAD = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
] as const;

export interface DtmfEvent {
  digit: string;
  startSeconds: number;
  durationSeconds: number;
  /** Ratio of the winning tone pair to the rest of the band. Higher is cleaner. */
  confidence: number;
}

/** Goertzel power for one frequency over one frame. */
function goertzel(samples: Float32Array, start: number, length: number, freq: number, rate: number): number {
  const k = Math.round((length * freq) / rate);
  const omega = (2 * Math.PI * k) / length;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < length; i++) {
    s0 = (samples[start + i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

export interface DecodeOptions {
  /** Frame length in ms. DTMF tones are >=40ms by spec; 25ms frames catch short presses. */
  frameMs?: number;
  /** Winning-pair power must exceed this multiple of the mean of the losing bins. */
  minRatio?: number;
  /** Frames below this energy are treated as silence. */
  silenceFloor?: number;
}

/**
 * Decode DTMF key presses from mono PCM samples in [-1, 1].
 */
export function decodeDtmf(samples: Float32Array, sampleRate: number, opts: DecodeOptions = {}): DtmfEvent[] {
  const frameMs = opts.frameMs ?? 25;
  const minRatio = opts.minRatio ?? 6;
  const silenceFloor = opts.silenceFloor ?? 1e-4;

  const frameLen = Math.floor((sampleRate * frameMs) / 1000);
  if (frameLen < 8) return [];

  const perFrame: { digit: string | null; confidence: number }[] = [];

  for (let start = 0; start + frameLen <= samples.length; start += frameLen) {
    let energy = 0;
    for (let i = 0; i < frameLen; i++) {
      const s = samples[start + i] ?? 0;
      energy += s * s;
    }
    energy /= frameLen;
    if (energy < silenceFloor) {
      perFrame.push({ digit: null, confidence: 0 });
      continue;
    }

    const lowPower = LOW.map((f) => goertzel(samples, start, frameLen, f, sampleRate));
    const highPower = HIGH.map((f) => goertzel(samples, start, frameLen, f, sampleRate));

    const li = argmax(lowPower);
    const hi = argmax(highPower);
    const lowWin = lowPower[li] ?? 0;
    const highWin = highPower[hi] ?? 0;

    const lowRest = mean(lowPower.filter((_, i) => i !== li));
    const highRest = mean(highPower.filter((_, i) => i !== hi));

    const lowRatio = lowRest > 0 ? lowWin / lowRest : 0;
    const highRatio = highRest > 0 ? highWin / highRest : 0;
    const confidence = Math.min(lowRatio, highRatio);

    // "Twist": the two tones of a real DTMF pair are within a few dB of each other. Speech
    // and hold music routinely produce one strong bin but never a balanced pair.
    const twistOk = lowWin > 0 && highWin > 0 && Math.abs(Math.log10(lowWin / highWin)) < 1.2;

    if (confidence >= minRatio && twistOk) {
      perFrame.push({ digit: KEYPAD[li]?.[hi] ?? null, confidence });
    } else {
      perFrame.push({ digit: null, confidence });
    }
  }

  // Collapse runs of identical frames into one press. A single isolated frame is noise.
  const events: DtmfEvent[] = [];
  let runDigit: string | null = null;
  let runStart = 0;
  let runFrames = 0;
  let runConfidence = 0;

  const flush = (endFrame: number) => {
    if (runDigit && runFrames >= 2) {
      events.push({
        digit: runDigit,
        startSeconds: (runStart * frameLen) / sampleRate,
        durationSeconds: ((endFrame - runStart) * frameLen) / sampleRate,
        confidence: Math.round((runConfidence / runFrames) * 10) / 10,
      });
    }
    runDigit = null;
    runFrames = 0;
    runConfidence = 0;
  };

  perFrame.forEach((f, i) => {
    if (f.digit === runDigit) {
      if (f.digit) {
        runFrames++;
        runConfidence += f.confidence;
      }
      return;
    }
    flush(i);
    runDigit = f.digit;
    runStart = i;
    runFrames = f.digit ? 1 : 0;
    runConfidence = f.digit ? f.confidence : 0;
  });
  flush(perFrame.length);

  return events;
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if ((xs[i] ?? 0) > (xs[best] ?? 0)) best = i;
  return best;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Minimal WAV reader: 16-bit PCM, any channel count, downmixed to mono.
 * ffmpeg is told to write exactly this, so nothing exotic needs handling.
 */
export function readWav(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file.');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataStart = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error('No data chunk in WAV.');
  if (bitsPerSample !== 16) throw new Error(`Only 16-bit PCM is supported, got ${bitsPerSample}.`);

  const frames = Math.floor(dataLength / (2 * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buffer.readInt16LE(dataStart + (i * channels + c) * 2);
    }
    out[i] = sum / channels / 32768;
  }
  return { samples: out, sampleRate };
}
