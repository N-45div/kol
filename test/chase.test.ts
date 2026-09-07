import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { numbersIn, unsupportedNumbers } from '../src/chase/numbers.ts';
import { verifyAnswer } from '../src/chase/verify.ts';
import { runChase, renderChase, type ChaseRequest } from '../src/chase/run.ts';
import { Atlas } from '../src/atlas/store.ts';
import type { CallRecord, CalleTransport, CreateCallRequest, TranscriptTurn } from '../src/calle/types.ts';

const LINE = '+15550001111';
const LEAF = 'GREEN FALCON SEVEN';

const MAIN_MENU =
  'Please listen carefully, as our menu options have recently changed. For member eligibility, ' +
  'press 1. For claims, press 2. For provider services, press 3.';
const SUB_MENU = 'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.';

const REAL_ANSWER =
  'Claim four four seven one was paid on August twelfth, in the amount of one thousand two ' +
  `hundred and forty dollars. Your confirmation reference is ${LEAF}.`;

function turns(...rows: [number, string, string][]): TranscriptTurn[] {
  return rows.map(([offset_seconds, speaker, text]) => ({ offset_seconds, speaker, text }));
}

function completedCall(opts: {
  answer: string;
  calleeText?: string;
  confidence?: number;
  status?: string;
  menus?: { level: number; prompt_heard: string; action_type: 'dtmf'; action_value: string }[];
  hold?: number;
}): CallRecord {
  const callee = opts.calleeText ?? REAL_ANSWER;
  return {
    id: 'call_test',
    status: opts.status ?? 'completed',
    task_completed: true,
    completion_confidence: { score: opts.confidence ?? 0.92, label: 'high' },
    structured_result: {
      reached_target: 'yes',
      target_name_used: 'claims',
      menu_levels: opts.menus ?? [
        { level: 1, prompt_heard: MAIN_MENU, action_type: 'dtmf', action_value: '2' },
        { level: 2, prompt_heard: SUB_MENU, action_type: 'dtmf', action_value: '1' },
      ],
      ...(opts.hold !== undefined ? { hold_seconds_estimate: opts.hold } : {}),
      final_answer: opts.answer,
    },
    recipients: [
      {
        attempts: [
          {
            transcript_turns: turns(
              [0, 'bot', 'Hello, I am an automated assistant calling about a claim.'],
              [4, 'user', 'Claims department, this is Dana speaking.'],
              [12, 'user', callee],
            ),
          },
        ],
      },
    ],
  };
}

/** A transport that returns one scripted call, so a chase can be tested without a network. */
function stubTransport(call: CallRecord): CalleTransport & { requests: CreateCallRequest[] } {
  const requests: CreateCallRequest[] = [];
  return {
    mode: 'replay',
    requests,
    async createCall(req) {
      requests.push(req);
      return call;
    },
    async getCall() {
      return call;
    },
    async getEvents() {
      return [];
    },
  };
}

function chaseRequest(overrides: Partial<ChaseRequest> = {}): ChaseRequest {
  return {
    lineE164: LINE,
    org: 'Fixture Health Plan',
    goal: 'claim_status',
    targetName: 'the claims department',
    question: 'what is the current status of claim 4471',
    reference: '4471',
    expectedLeafMarker: LEAF,
    ...overrides,
  };
}

function freshAtlas(): Atlas {
  return new Atlas(join(mkdtempSync(join(tmpdir(), 'kol-chase-')), 'routes.json'));
}

test('spoken numbers are heard as numbers', () => {
  assert.ok(numbersIn('claim four four seven one').has('4471'));
  assert.ok(numbersIn('one thousand two hundred and forty dollars').has('1240'));
  assert.ok(numbersIn('paid on August twelfth').has('12'));
  assert.ok(numbersIn('the amount was $1,240.00').has('1240'));
  assert.ok(numbersIn('reference 4471').has('4471'));
});

test('an identifier next to an amount is not merged into a number nobody said', () => {
  // The pause a person makes between the two is a comma in the transcript. Without honouring
  // it, this sentence yields 44711 and 17240 and slanders an honest answer.
  const spoken = 'claim four four seven one, one thousand two hundred and forty dollars, August twelfth';
  const found = numbersIn(spoken);
  assert.ok(found.has('4471'), 'the claim number');
  assert.ok(found.has('1240'), 'the amount');
  assert.ok(found.has('12'), 'the day');
  assert.equal(found.has('44711'), false, 'the run must not swallow the next phrase');
  assert.equal(found.has('17240'), false, 'the cardinal must not swallow the previous run');
});

test('a number the callee never said is unsupported', () => {
  assert.deepEqual(unsupportedNumbers('claim 4471 paid 1240', REAL_ANSWER), []);
  // The classic hallucination: right shape, wrong amount.
  assert.deepEqual(unsupportedNumbers('claim 4471 paid 1420', REAL_ANSWER), ['1420']);
  assert.deepEqual(unsupportedNumbers('claim 9999', REAL_ANSWER), ['9999']);
});

test('an answer grounded in the transcript verifies', () => {
  const v = verifyAnswer({
    call: completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.' }),
    answer: 'Claim 4471 was paid on August 12 for $1,240.',
    expectedLeafMarker: LEAF,
  });
  assert.equal(v.verdict, 'verified');
  assert.deepEqual(v.unsupportedNumbers, []);
  assert.ok(v.supportingSpan, 'a supporting span is identified');
  assert.equal(v.checks.every((c) => c.passed), true);
});

test('a fabricated amount is contradicted, not merely unsupported', () => {
  const v = verifyAnswer({
    call: completedCall({ answer: 'Claim 4471 was paid for $1,420.' }),
    answer: 'Claim 4471 was paid for $1,420.',
    expectedLeafMarker: LEAF,
  });
  assert.equal(v.verdict, 'contradicted');
  assert.deepEqual(v.unsupportedNumbers, ['1420']);
  assert.match(v.summary, /nobody said/);
});

test('reaching the wrong department is contradicted even when the answer sounds right', () => {
  const wrongDept = completedCall({
    answer: 'Claim 4471 was paid on August 12 for $1,240.',
    calleeText: 'Provider services. Your reference for this department is RED MARLIN NINE.',
  });
  const v = verifyAnswer({
    call: wrongDept,
    answer: 'Claim 4471 was paid on August 12 for $1,240.',
    expectedLeafMarker: LEAF,
  });
  assert.equal(v.verdict, 'contradicted');
  // Two independent checks catch this: the leaf marker was never heard, and the amount the
  // answer quotes was never spoken by provider services either.
  const destination = v.checks.find((c) => c.name === 'reached the intended destination');
  assert.equal(destination?.passed, false);
  assert.match(destination!.detail, /never heard "GREEN FALCON SEVEN"/);
  assert.ok(v.unsupportedNumbers.length > 0, 'the quoted figures were not said by this department');
});

test('the destination check alone is enough, even when the numbers happen to match', () => {
  // The dangerous case: a wrong department that recites the same figures back.
  const v = verifyAnswer({
    call: completedCall({
      answer: 'Claim 4471 was paid on August 12 for $1,240.',
      calleeText: `Provider services here. I can see claim four four seven one, one thousand two hundred and forty dollars, August twelfth.`,
    }),
    answer: 'Claim 4471 was paid on August 12 for $1,240.',
    expectedLeafMarker: LEAF,
  });
  assert.equal(v.verdict, 'contradicted');
  assert.deepEqual(v.unsupportedNumbers, [], 'every number was in fact spoken');
  assert.match(v.summary, /did not reach the intended destination/);
});

test('voicemail is never an answer', () => {
  const v = verifyAnswer({
    call: { id: 'c', status: 'voicemail', recipients: [] },
    answer: 'Claim 4471 was paid.',
  });
  assert.equal(v.verdict, 'unreachable');
  assert.match(v.summary, /voicemail/);
});

test('low provider confidence downgrades an otherwise clean answer', () => {
  const v = verifyAnswer({
    call: completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.', confidence: 0.35 }),
    answer: 'Claim 4471 was paid on August 12 for $1,240.',
    expectedLeafMarker: LEAF,
  });
  assert.equal(v.verdict, 'unsupported');
  assert.match(v.summary, /low confidence/);
});

test('a first chase explores, verifies, and teaches the atlas', async () => {
  const atlas = freshAtlas();
  const transport = stubTransport(completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.', hold: 38 }));

  const result = await runChase(chaseRequest(), { transport, atlas, now: '2026-09-07T10:00:00Z' });

  assert.equal(result.mode, 'explore');
  assert.equal(result.verification.verdict, 'verified');
  assert.equal(result.needsHuman, false);
  assert.equal(result.atlas.outcome, 'learned');
  assert.equal(result.atlas.route?.version, 1);
  assert.deepEqual(result.timing.keysPressed, ['2', '1']);
  assert.equal(result.timing.holdSeconds, 38);
  // Explore prose must not contain a route it does not have.
  assert.doesNotMatch(result.task, /press 2/i);
  assert.match(result.task, /Listen to the whole menu/i);
  assert.equal(transport.requests[0]?.metadata?.['kol_mode'], 'explore');
});

test('the second chase replays the learned route and compiles it into the task', async () => {
  const atlas = freshAtlas();
  const call = completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.', hold: 40 });
  const transport = stubTransport(call);

  await runChase(chaseRequest(), { transport, atlas, now: '2026-09-07T10:00:00Z' });
  const second = await runChase(chaseRequest(), { transport, atlas, now: '2026-09-07T11:00:00Z' });

  assert.equal(second.mode, 'replay');
  assert.equal(second.atlas.outcome, 'confirmed');
  assert.equal(second.atlas.route?.confirmations, 2);
  assert.match(second.task, /At the first menu, press 2\./);
  assert.match(second.task, /stop following these directions/i);
  // The hold time the first call measured is compiled into the second call's instructions.
  assert.match(second.task, /roughly 40 seconds/);
  assert.equal(transport.requests[1]?.metadata?.['kol_route_version'], 1);
});

test('a contradicted chase never teaches the atlas, and quarantines the route it used', async () => {
  const atlas = freshAtlas();
  const good = stubTransport(completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.' }));
  await runChase(chaseRequest(), { transport: good, atlas, now: '2026-09-07T10:00:00Z' });
  assert.equal(atlas.get(LINE, 'claim_status')?.status, 'fresh');

  // Same line, but the call lands in provider services and invents an amount.
  const bad = stubTransport(completedCall({
    answer: 'Claim 4471 was paid for $1,420.',
    calleeText: 'Provider services. Your reference for this department is RED MARLIN NINE.',
  }));
  const result = await runChase(chaseRequest(), { transport: bad, atlas, now: '2026-09-07T12:00:00Z' });

  assert.equal(result.verification.verdict, 'contradicted');
  assert.equal(result.needsHuman, true);
  assert.equal(result.atlas.outcome, 'quarantined');
  assert.equal(atlas.get(LINE, 'claim_status')?.status, 'stale', 'a route that produced a bad answer stops being replayable');
  assert.equal(atlas.get(LINE, 'claim_status')?.confirmations, 1, 'the bad call did not earn confidence');
});

test('a retry within the hour reuses the call rather than dialling twice', async () => {
  const atlas = freshAtlas();
  // A contradicted answer teaches the atlas nothing, so every chase here stays in explore
  // mode — which is exactly the situation a crashed-and-restarted process is in.
  const transport = stubTransport(completedCall({ answer: 'Claim 4471 was paid for $1,420.' }));
  const keys: string[] = [];
  const capturing: CalleTransport = {
    mode: 'replay',
    async createCall(req, key) {
      keys.push(key);
      return transport.createCall(req, key);
    },
    getCall: transport.getCall,
    getEvents: transport.getEvents,
  };

  await runChase(chaseRequest(), { transport: capturing, atlas, now: '2026-09-07T10:00:00Z' });
  await runChase(chaseRequest(), { transport: capturing, atlas, now: '2026-09-07T10:59:00Z' });
  await runChase(chaseRequest(), { transport: capturing, atlas, now: '2026-09-07T12:00:00Z' });

  assert.equal(keys[0], keys[1], 'a retry inside the hour reuses the call');
  assert.notEqual(keys[1], keys[2], 'a later chase is a new call');
  assert.doesNotMatch(keys[0]!, /\+/, 'the key carries no raw E.164');
});

test('explore and replay are different calls, so they never share an idempotency key', async () => {
  const atlas = freshAtlas();
  const transport = stubTransport(completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.' }));
  const keys: string[] = [];
  const capturing: CalleTransport = {
    mode: 'replay',
    async createCall(req, key) {
      keys.push(key);
      return transport.createCall(req, key);
    },
    getCall: transport.getCall,
    getEvents: transport.getEvents,
  };

  await runChase(chaseRequest(), { transport: capturing, atlas, now: '2026-09-07T10:00:00Z' });
  await runChase(chaseRequest(), { transport: capturing, atlas, now: '2026-09-07T10:30:00Z' });

  assert.match(keys[0]!, /-explore-/);
  assert.match(keys[1]!, /-replay-/);
  assert.notEqual(keys[0], keys[1], 'a replay must not be deduplicated against the explore that taught it');
});

test('the rendered report shows the route, the grounding span, and every check', async () => {
  const atlas = freshAtlas();
  const call = completedCall({ answer: 'Claim 4471 was paid on August 12 for $1,240.', hold: 38 });
  const result = await runChase(chaseRequest(), { transport: stubTransport(call), atlas, now: '2026-09-07T10:00:00Z' });
  const text = renderChase(result, call);

  assert.match(text, /VERIFIED/);
  assert.match(text, /pressed 2/);
  assert.match(text, /pressed 1/);
  assert.match(text, /grounded at 12s/);
  assert.match(text, /numbers were spoken/);
  assert.match(text, /reached the intended destination/);
  assert.match(text, /Atlas: learned/);
  assert.match(text, /Transcript \(untrusted call data\)/);
});

test('a contradicted report says plainly that it is not safe to act on', async () => {
  const atlas = freshAtlas();
  const call = completedCall({ answer: 'Claim 4471 was paid for $1,420.' });
  const result = await runChase(chaseRequest(), { transport: stubTransport(call), atlas, now: '2026-09-07T10:00:00Z' });
  const text = renderChase(result, call);

  assert.match(text, /CONTRADICTED/);
  assert.match(text, /FAIL numbers were spoken/);
  assert.match(text, /not safe to act on/);
});
