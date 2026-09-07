import { Atlas } from '../atlas/store.ts';
import { createTransport, LiveCalle } from '../calle/index.ts';
import { renderChase, runChase, type ChaseRequest } from '../chase/run.ts';
import { maskE164 } from '../util/mask.ts';

/**
 * Run one chase.
 *
 *   npm run chase -- --line +1XXXXXXXXXX --goal claim_status --ask "what is the status of claim 4471" \
 *                    --ref 4471 --target "the claims department" --marker "GREEN FALCON SEVEN"
 *
 * Replay is the default. A live call requires KOL_MODE=live and --confirm, and prints the
 * masked destination and the cost before dialling.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const line = arg('line') ?? process.env['KOL_FIXTURE_LINE'] ?? '';
const goal = arg('goal') ?? 'claim_status';
const question = arg('ask') ?? 'what is the current status of the claim';

if (!line) {
  console.error('Need --line +1XXXXXXXXXX (or KOL_FIXTURE_LINE in .env).');
  process.exitCode = 1;
} else {
  const request: ChaseRequest = {
    lineE164: line,
    org: arg('org') ?? 'Fixture Health Plan',
    goal,
    targetName: arg('target') ?? 'the claims department',
    question,
    ...(arg('ref') ? { reference: arg('ref')! } : {}),
    ...(arg('marker') ? { expectedLeafMarker: arg('marker')! } : {}),
  };

  const transport = createTransport();
  const atlas = new Atlas(arg('atlas') ?? './atlas/routes.json');

  console.log('');
  console.log(`  line       ${maskE164(line)}`);
  console.log(`  goal       ${goal}`);
  console.log(`  question   ${question}`);
  console.log(`  mode       ${transport.mode}${transport.mode === 'live' ? '   REAL CALL, ~$0.05' : '   replaying recorded artifacts, no call'}`);

  if (transport.mode === 'live' && !process.argv.includes('--confirm')) {
    console.log('\n  Refusing to dial without --confirm. Nothing was called.\n');
  } else {
    try {
      const result = await runChase(request, {
        transport,
        atlas,
        now: new Date().toISOString(),
        ...(arg('scenario') ? { scenario: arg('scenario')! } : {}),
        ...(arg('webhook') ? { webhookUrl: arg('webhook')! } : {}),
        onProgress: (text) => console.log(`  ${text}`),
      });

      const call = await transport.getCall(result.callId).catch(() => undefined);
      console.log(renderChase(result, call));

      if (transport instanceof LiveCalle) {
        console.log(`  Recorded as artifacts/${result.scenario}/ — replayable with KOL_MODE=replay.\n`);
      }
      process.exitCode = result.needsHuman ? 1 : 0;
    } catch (error) {
      // A missing recording is the normal state before the first live call, not a crash.
      console.log('');
      console.log(`  ${error instanceof Error ? error.message : String(error)}`);
      console.log('');
      process.exitCode = 1;
    }
  }
}
