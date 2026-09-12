/**
 * Day-0 probes. Each one answers a question that can kill or reshape Kol, and each one
 * costs real money out of a 20-call budget, so:
 *
 *   - nothing dials without --confirm
 *   - the masked destination and the reason are printed before the call
 *   - every response is recorded to artifacts/ the instant it lands
 *
 * Usage:
 *   KOL_MODE=live node --env-file=.env probes/run.ts p1 --confirm
 *   KOL_MODE=live node --env-file=.env probes/run.ts p3 --via self --confirm
 *
 * --via fixture   dial KOL_FIXTURE_LINE, the synthetic IVR behind a real DID (default)
 * --via self      dial KOL_SELF_LINE, the laptop fixture: your own phone on speaker beside
 *                 the laptop, which plays the menu and records the keypresses it hears.
 *                 Region and locale follow the number's country code.
 *
 * P1  reachability   Does CALL-E's International line actually land on an Indian mobile,
 *                    and what do the response fields really look like?
 * P2  navigation     THE decisive one. Given only a department name, will CALL-E press keys
 *                    through a two-level IVR, and will it tell us which ones?
 * P3  steering       Can the route be dictated in the task text? This is what makes Replay
 *                    possible, and therefore what makes the whole product possible.
 */

import { createTransport } from '../src/calle/index.ts';
import { pollUntilTerminal } from '../src/calle/poll.ts';
import { allTurns, type CallRecord, type CreateCallRequest } from '../src/calle/types.ts';
import { maskE164 } from '../src/util/mask.ts';

/** What Explore asks a call to report about its own navigation. */
export const ROUTE_SCHEMA = {
  type: 'object',
  required: ['reached_target', 'menu_levels'],
  properties: {
    reached_target: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    target_name_used: { type: 'string' },
    menu_levels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'prompt_heard', 'action_type'],
        properties: {
          level: { type: 'integer' },
          prompt_heard: { type: 'string' },
          options_offered: { type: 'array', items: { type: 'string' } },
          action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
          action_value: { type: 'string' },
        },
      },
    },
    hold_seconds_estimate: { type: 'number' },
    final_answer: { type: 'string' },
  },
} as const;

interface Probe {
  id: string;
  question: string;
  build(env: NodeJS.ProcessEnv, line: Line): CreateCallRequest;
}

type Via = 'fixture' | 'self';
interface Line { phone: string; region: string; locale: string }

/** The IVR under test. Region and locale follow the country code, never a hard-coded US. */
function lineFor(env: NodeJS.ProcessEnv, via: Via): Line {
  const phone = required(env, via === 'self' ? 'KOL_SELF_LINE' : 'KOL_FIXTURE_LINE');
  const india = phone.startsWith('+91');
  return { phone, region: india ? 'IN' : 'US', locale: india ? 'en-IN' : 'en-US' };
}

const PROBES: Probe[] = [
  {
    id: 'p4',
    question:
      "Does US outbound work from this account, and what is on CALL-E's official test hotline?",
    build: (env) => ({
      task:
        'Call this number. It is CALL-E\'s own published test line, so there is no need to ask ' +
        'permission or explain yourself at length. Your job is reconnaissance: listen carefully ' +
        'to everything the line says from the very first second. If it plays an automated menu ' +
        'with options, write down exactly what the menu said and which options it offered, then ' +
        'choose any option that sounds like it leads to a person or to more information, using ' +
        'the keypad if the menu asks for a key. Report precisely which key you pressed or which ' +
        'words you spoke. If instead a person or an assistant answers and talks with you, say ' +
        'that you are an automated test call checking connectivity, ask what this line is for, ' +
        'and note their answer. Either way, report the first thing you heard word for word, ' +
        'whether it was a recording or a live voice, whether any keypad menu existed at all, ' +
        'and roughly how long you waited before anything happened.',
      recipients: [
        { phones: [required(env, 'KOL_CALLE_TEST_LINE')], region: 'US', locale: 'en-US' },
      ],
      result_schema: ROUTE_SCHEMA as unknown as Record<string, unknown>,
      metadata: { kol_scenario: 'probe-p4-calle-hotline' },
    }),
  },
  {
    id: 'p1',
    question: 'Does the International line reach a +91 mobile, and what are the real field names?',
    build: (env) => ({
      task:
        'Call the recipient. Say clearly that you are an automated assistant calling as a ' +
        'connectivity test for a developer project, that no action is needed, and ask them ' +
        'to say the word "green" if they can hear you clearly. Then thank them and end the ' +
        'call. Keep it under thirty seconds.',
      recipients: [{ phones: [required(env, 'KOL_SELF_LINE')], region: 'IN', locale: 'en-IN' }],
      result_schema: {
        type: 'object',
        required: ['heard_clearly'],
        properties: {
          heard_clearly: { type: 'string', enum: ['yes', 'no', 'unknown'] },
          codeword_spoken: { type: 'string' },
        },
      },
      metadata: { kol_scenario: 'probe-p1-reachability' },
    }),
  },
  {
    id: 'p2',
    question: 'Will CALL-E navigate a two-level IVR unaided, and report the keys it pressed?',
    build: (_env, line) => ({
      task:
        'Call this line and reach the claims department. It is an automated phone menu, so ' +
        'listen to the options and choose the one that leads to claims, using the keypad if ' +
        'the menu asks for it. When you reach the claims line, ask for the status of claim ' +
        'number 4471 and write down exactly what you are told. Then report, for every menu ' +
        'you heard: what the menu said, what options it offered, and precisely which key you ' +
        'pressed or what you said to get past it.',
      recipients: [{ phones: [line.phone], region: line.region, locale: line.locale }],
      result_schema: ROUTE_SCHEMA as unknown as Record<string, unknown>,
      metadata: { kol_scenario: 'probe-p2-navigation' },
    }),
  },
  {
    id: 'p3',
    question: 'Can the route be dictated up front, so a second call skips the exploring?',
    build: (_env, line) => ({
      task:
        'Call this line. It is an automated phone menu and the route is already known: at ' +
        'the first menu press 2, then at the second menu press 1. Do not explore the other ' +
        'options. Once you reach the claims line, ask for the status of claim number 4471 ' +
        'and report exactly what you are told. Also report whether the menu still said what ' +
        'we expected at each step, and which keys you actually pressed.',
      recipients: [{ phones: [line.phone], region: line.region, locale: line.locale }],
      result_schema: ROUTE_SCHEMA as unknown as Record<string, unknown>,
      metadata: { kol_scenario: 'probe-p3-steering' },
    }),
  },
];

async function main(): Promise<void> {
  const [id, ...flags] = process.argv.slice(2);
  const probe = PROBES.find((p) => p.id === id);
  if (!probe) {
    console.error(`Usage: node probes/run.ts <${PROBES.map((p) => p.id).join('|')}> [--via fixture|self] [--confirm]`);
    console.error('');
    for (const p of PROBES) console.error(`  ${p.id}  ${p.question}`);
    process.exitCode = 1;
    return;
  }

  const viaIndex = flags.indexOf('--via');
  const via = viaIndex === -1 ? 'fixture' : flags[viaIndex + 1];
  if (via !== 'fixture' && via !== 'self') {
    console.error(`--via must be "fixture" or "self", not ${JSON.stringify(via ?? '')}.`);
    process.exitCode = 1;
    return;
  }

  const transport = createTransport();
  const req = probe.build(process.env, lineFor(process.env, via));
  const destination = maskE164(req.recipients[0]!.phones[0]!);

  console.log(`\n${probe.id.toUpperCase()} — ${probe.question}`);
  console.log(`mode        ${transport.mode}${transport.mode === 'live' ? '  (REAL CALL, ~$0.05)' : '  (no call placed)'}`);
  console.log(`destination ${destination}  (${req.recipients[0]!.region}, ${req.recipients[0]!.locale})`);
  console.log(`scenario    ${req.metadata!['kol_scenario']}`);

  if (transport.mode === 'live' && !flags.includes('--confirm')) {
    console.log('\nRefusing to dial without --confirm. Nothing was called.');
    return;
  }

  const idempotencyKey = `kol-${probe.id}-${new Date().toISOString().slice(0, 13)}`;
  const created = await transport.createCall(req, idempotencyKey);
  const callId = String(created.id ?? created.call_id ?? '');
  console.log(`\ncall_id     ${callId || '(none returned — note this)'}`);
  console.log(`status      ${created.status ?? '(none)'}`);

  const final = await pollUntilTerminal(transport, callId, {
    onProgress: (c, ms) => console.log(`  ${String(Math.round(ms / 1000)).padStart(4)}s  ${c.status ?? '...'}`),
  });

  report(final);
}

function report(call: CallRecord): void {
  console.log('\n--- result ---------------------------------------------------');
  console.log(`status               ${call.status}`);
  console.log(`task_completed       ${call.task_completed}`);
  console.log(`completion_confidence ${JSON.stringify(call.completion_confidence ?? null)}`);
  console.log(`structured_result    ${JSON.stringify(call.structured_result ?? null, null, 2)}`);
  console.log(`evidence             ${JSON.stringify(call.evidence ?? null)}`);

  const turns = allTurns(call);
  console.log(`\ntranscript turns     ${turns.length}`);
  for (const t of turns) {
    console.log(`  ${String(t.offset_seconds).padStart(4)}s ${t.speaker.padEnd(5)} ${t.text}`);
  }

  console.log('\n--- keys to check by hand ------------------------------------');
  console.log(Object.keys(call).sort().join(', '));
  console.log('\nRecorded under artifacts/. Log anything surprising in docs/BUGLOG.md.');
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set in .env — see .env.example.`);
  return v;
}

await main();
