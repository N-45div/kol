import { readFile } from 'node:fs/promises';
import { decodeDtmf, readWav } from './decode.ts';

/**
 * Read the keys CALL-E pressed out of a call recording.
 *
 *   npm run dtmf -- fixtures/laptop/recordings/call-20260904-183000.wav
 *
 * Prints one line per press with its timestamp, so the sequence can be compared against what
 * the task prose asked for and against what the call claimed in its structured result.
 */
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npm run dtmf -- <recording.wav>');
    process.exitCode = 1;
    return;
  }

  const { samples, sampleRate } = readWav(await readFile(path));
  const seconds = samples.length / sampleRate;
  const events = decodeDtmf(samples, sampleRate);

  console.log(`\n${path}`);
  console.log(`${seconds.toFixed(1)}s at ${sampleRate} Hz\n`);

  if (events.length === 0) {
    console.log('No DTMF detected.');
    console.log('');
    console.log('That is a real result, not a failure of this tool: either CALL-E never');
    console.log('pressed a key, or it spoke its choice instead. Check the transcript for what');
    console.log('it said, and check that the phone was on speakerphone next to the mic.');
    return;
  }

  console.log('  time     key   duration   confidence');
  console.log('  ------   ---   --------   ----------');
  for (const e of events) {
    console.log(
      `  ${e.startSeconds.toFixed(2).padStart(6)}s   ${e.digit.padEnd(3)}   ` +
        `${(e.durationSeconds * 1000).toFixed(0).padStart(5)}ms   ${e.confidence}`,
    );
  }
  console.log(`\nSequence pressed: ${events.map((e) => e.digit).join(' ')}`);
}

await main();
