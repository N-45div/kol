/**
 * Resume polling a call that was created but whose process died before it finished.
 *
 *   KOL_MODE=live node --env-file=.env probes/resume.ts <scenario> <call_id>
 *
 * Never places a call. Adopts the id into the scenario so every poll is recorded into
 * artifacts/<scenario>/ exactly as if the original process had lived.
 */

import { createTransport, LiveCalle } from '../src/calle/index.ts';
import { pollUntilTerminal } from '../src/calle/poll.ts';
import { allTurns } from '../src/calle/types.ts';

const [scenario, callId] = process.argv.slice(2);
if (!scenario || !callId) {
  console.error('Usage: node probes/resume.ts <scenario> <call_id>');
  process.exitCode = 1;
} else {
  const transport = createTransport();
  if (transport instanceof LiveCalle) transport.adopt(callId, scenario);

  const final = await pollUntilTerminal(transport, callId, {
    firstDelayMs: 0,
    onProgress: (c, ms) =>
      console.log(
        `  ${String(Math.round(ms / 1000)).padStart(4)}s  ${c.status ?? '...'}` +
          `  recipient=${c.recipients?.[0]?.status ?? '-'}`,
      ),
  });

  console.log('\n--- result ---------------------------------------------------');
  console.log(`status                ${final.status}`);
  console.log(`task_completed        ${final.task_completed}`);
  console.log(`completion_confidence ${JSON.stringify(final.completion_confidence ?? null)}`);
  console.log(`failure               ${final.failure_code ?? '-'} ${final.failure_message ?? ''}`);
  console.log(`summary               ${final.summary ?? '-'}`);
  console.log(`structured_result     ${JSON.stringify(final.structured_result ?? null, null, 2)}`);
  console.log(`evidence              ${JSON.stringify(final.evidence ?? null)}`);
  const turns = allTurns(final);
  console.log(`\ntranscript turns      ${turns.length}`);
  for (const t of turns) console.log(`  ${String(t.offset_seconds).padStart(4)}s ${t.speaker.padEnd(5)} ${t.text}`);
  console.log('\nRecorded under artifacts/' + scenario + '/');
}
