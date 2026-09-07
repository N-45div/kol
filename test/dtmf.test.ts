import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDtmf, readWav } from '../src/dtmf/decode.ts';

const RATE = 8000;

const TONES: Record<string, [number, number]> = {
  '0': [941, 1336], '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], '7': [852, 1209],
  '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '#': [941, 1477],
};

/** Build a mono buffer containing tones and gaps, optionally polluted with noise. */
function synth(
  parts: ({ digit: string; ms: number } | { silence: number })[],
  opts: { noise?: number; speechHz?: number } = {},
): Float32Array {
  const chunks: number[] = [];
  for (const p of parts) {
    if ('silence' in p) {
      for (let i = 0; i < (RATE * p.silence) / 1000; i++) chunks.push(0);
      continue;
    }
    const [lo, hi] = TONES[p.digit]!;
    const n = Math.floor((RATE * p.ms) / 1000);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      chunks.push(0.4 * Math.sin(2 * Math.PI * lo * t) + 0.4 * Math.sin(2 * Math.PI * hi * t));
    }
  }
  const out = new Float32Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    let v = chunks[i] ?? 0;
    if (opts.speechHz) v += 0.25 * Math.sin(2 * Math.PI * opts.speechHz * (i / RATE));
    if (opts.noise) v += opts.noise * (Math.sin(i * 12.9898) * 43758.5453 % 1);
    out[i] = v;
  }
  return out;
}

test('decodes a clean two-key sequence in order', () => {
  const audio = synth([
    { silence: 200 },
    { digit: '2', ms: 120 },
    { silence: 400 },
    { digit: '1', ms: 120 },
    { silence: 200 },
  ]);
  const events = decodeDtmf(audio, RATE);
  assert.deepEqual(events.map((e) => e.digit), ['2', '1']);
  assert.ok(events[0]!.startSeconds > 0.15 && events[0]!.startSeconds < 0.3);
  assert.ok(events[1]!.startSeconds > 0.6);
});

test('decodes every key on the keypad', () => {
  for (const digit of Object.keys(TONES)) {
    const events = decodeDtmf(synth([{ silence: 60 }, { digit, ms: 100 }, { silence: 60 }]), RATE);
    assert.deepEqual(events.map((e) => e.digit), [digit], `failed on ${digit}`);
  }
});

test('survives speech and noise on the line', () => {
  const audio = synth(
    [{ silence: 200 }, { digit: '2', ms: 120 }, { silence: 300 }, { digit: '1', ms: 120 }, { silence: 200 }],
    { noise: 0.05, speechHz: 300 },
  );
  assert.deepEqual(decodeDtmf(audio, RATE).map((e) => e.digit), ['2', '1']);
});

test('does not hallucinate digits from speech alone', () => {
  // A voice-like sweep with no DTMF pair present must produce nothing.
  const n = RATE * 3;
  const audio = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    audio[i] = 0.4 * Math.sin(2 * Math.PI * (200 + 120 * Math.sin(2 * Math.PI * 1.5 * t)) * t);
  }
  assert.deepEqual(decodeDtmf(audio, RATE), []);
});

test('does not report a single-frame blip as a press', () => {
  const audio = synth([{ silence: 100 }, { digit: '5', ms: 15 }, { silence: 100 }]);
  assert.deepEqual(decodeDtmf(audio, RATE), []);
});

test('reads a 16-bit PCM WAV written the way ffmpeg is told to write it', () => {
  const samples = synth([{ silence: 100 }, { digit: '7', ms: 120 }, { silence: 100 }]);
  const wav = writeWav(samples, RATE);
  const back = readWav(wav);
  assert.equal(back.sampleRate, RATE);
  assert.deepEqual(decodeDtmf(back.samples, back.sampleRate).map((e) => e.digit), ['7']);
});

function writeWav(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
