import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Atlas } from '../src/atlas/store.ts';
import { preflight, renderPreflight } from '../src/chase/preflight.ts';
import { runChaseWithEscalation, renderPacket } from '../src/chase/escalate.ts';
import { runChase, type ChaseRequest } from '../src/chase/run.ts';
import type { CallRecord, CalleTransport, TranscriptTurn } from '../src/calle/types.ts';
import type { Route } from '../src/atlas/types.ts';

const LINE = '+15550001111';
const LEAF = 'GREEN FALCON SEVEN';
const MAIN_MENU =
  'Please listen carefully, as our menu options have recently changed. For member eligibility, ' +
  'press 1. For claims, press 2. For provider services, press 3.';
const SUB_MENU = 'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.';
const GOOD_ANSWER = 'Claim 4471 was paid on August 12 for $1,240.';
const SPOKEN =
  'Claim four four seven one was paid on August twelfth, in the amount of one thousand two ' +
  `hundred and forty dollars. Your confirmation reference is ${LEAF}.`;

function turns(...rows: [number, string, string][]): TranscriptTurn[] {
  return rows.map(([offset_seconds, speaker, text]) => ({ offset_seconds, speaker, text }));
}

function call(opts: { answer: string; calleeText?: string; hold?: number }): CallRecord {
  return {
    id: 'call_test',
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.92, label: 'high' },
    structured_result: {
      reached_target: 'yes',
      target_name_used: 'claims',
      menu_levels: [
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
              [12, 'user', opts.calleeText ?? SPOKEN],
            ),
          },
        ],
      },
    ],
  };
}

/** A transport whose reply can change between attempts, so a ladder can be tested. */
function scriptedTransport(sequence: CallRecord[]): CalleTransport & { placed: number } {
  let index = 0;
  const state = {
    mode: 'replay' as const,
    placed: 0,
    async createCall() {
      state.placed += 1;
      return sequence[Math.min(index++, sequence.length - 1)]!;
    },
    async getCall() {
      return sequence[Math.min(index - 1, sequence.length - 1)]!;
    },
    async getEvents() {
      return [];
    },
  };
  return state;
}

function request(): ChaseRequest {
  return {
    lineE164: LINE,
    org: 'Fixture Health Plan',
    goal: 'claim_status',
    targetName: 'the claims department',
    question: 'what is the current status of claim 4471',
    reference: '4471',
    expectedLeafMarker: LEAF,
  };
}

function freshAtlas(): Atlas {
  return new Atlas(join(mkdtempSync(join(tmpdir(), 'kol-esc-')), 'routes.json'));
}

function routeWith(observed: Route['observed'], hold?: Route['hold']): Route {
  return {
    lineE164: LINE,
    org: 'Fixture Health Plan',
    goal: 'claim_status',
    targetName: 'claims',
    steps: [{ level: 1, heard: MAIN_MENU, action: { type: 'dtmf', value: '2' } }],
    fingerprint: 'abc',
    version: 1,
    status: 'fresh',
    firstObservedAt: '',
    lastVerifiedAt: '',
    confirmations: 2,
    corrections: 0,
    ...(observed ? { observed } : {}),
    ...(hold ? { hold } : {}),
  };
}

// ---------------------------------------------------------------------------- preflight

test('with no history, the estimate says so rather than inventing a number', () => {
  const e = preflight(undefined);
  assert.equal(e.mode, 'explore');
  assert.equal(e.basis, 'none');
  assert.equal(e.expectedSeconds, undefined);
  assert.match(e.summary, /never been timed/);
  assert.match(renderPreflight(e), /unknown duration/);
});

test('an explore timing is never presented as a replay estimate', () => {
  const e = preflight(routeWith({ explore: { samples: 2, p50Seconds: 380, p90Seconds: 420 } }));
  assert.equal(e.mode, 'replay', 'the route is replayable');
  assert.equal(e.basis, 'other-mode');
  assert.equal(e.expectedSeconds, undefined, 'no figure is offered for an unmeasured mode');
  assert.match(e.summary, /No replay call to this line has been timed yet/);
  assert.match(e.summary, /explore took about 380s/);
});

test('with both modes measured, the estimate quantifies what replay saves', () => {
  const e = preflight(routeWith(
    { explore: { samples: 2, p50Seconds: 380, p90Seconds: 420 }, replay: { samples: 3, p50Seconds: 95, p90Seconds: 130 } },
    { samples: 3, p50Seconds: 60, p90Seconds: 90 },
  ));
  assert.equal(e.basis, 'measured');
  assert.equal(e.expectedSeconds, 95);
  assert.equal(e.worstSeconds, 130);
  assert.equal(e.samples, 3);
  assert.equal(e.savedVersusExploreSeconds, 285);
  assert.equal(e.expectedHoldSeconds, 60);
  assert.match(e.summary, /about 95s on replay, from 3 previous calls/);
  assert.match(e.summary, /60s of that is hold the agent waits through/);
  assert.match(e.summary, /285s shorter than exploring/);
});

test('the atlas records durations per mode, and never blends them', async () => {
  const atlas = freshAtlas();
  const good = call({ answer: GOOD_ANSWER, hold: 40 });

  const explore = scriptedTransport([good]);
  const first = await runChase(request(), { transport: explore, atlas, now: '2026-09-08T10:00:00Z' });
  assert.equal(first.mode, 'explore');
  assert.equal(first.estimate.basis, 'none', 'the first call had nothing to estimate from');

  const replay = scriptedTransport([good]);
  const second = await runChase(request(), { transport: replay, atlas, now: '2026-09-08T11:00:00Z' });
  assert.equal(second.mode, 'replay');

  const stored = atlas.get(LINE, 'claim_status')!;
  assert.equal(stored.observed?.explore?.samples, 1);
  assert.equal(stored.observed?.replay?.samples, 1);
  assert.notEqual(stored.observed?.explore, stored.observed?.replay);
});

// --------------------------------------------------------------------------- escalation

test('a verified chase never escalates', async () => {
  const atlas = freshAtlas();
  const transport = scriptedTransport([call({ answer: GOOD_ANSWER })]);
  const result = await runChaseWithEscalation(request(), { transport, atlas, now: '2026-09-08T10:00:00Z' });

  assert.equal(result.callsPlaced, 1);
  assert.equal(result.escalated, false);
  assert.equal(result.packet, undefined);
  assert.equal(result.final.verification.verdict, 'verified');
});

test('a contradicted explore stops at one call — there is no route to blame', async () => {
  const atlas = freshAtlas();
  const transport = scriptedTransport([call({ answer: 'Claim 4471 was paid for $1,420.' })]);
  const result = await runChaseWithEscalation(request(), { transport, atlas, now: '2026-09-08T10:00:00Z' });

  assert.equal(result.callsPlaced, 1, 'retrying would ask the same question the same way');
  assert.equal(result.escalated, false);
  assert.ok(result.packet);
  assert.match(result.packet.reason, /no cached route to blame/);
});

test('a contradicted replay retries once from scratch, and stops there', async () => {
  const atlas = freshAtlas();
  await runChase(request(), { transport: scriptedTransport([call({ answer: GOOD_ANSWER })]), atlas, now: '2026-09-08T10:00:00Z' });
  assert.equal(atlas.get(LINE, 'claim_status')?.status, 'fresh');

  // Both the replay and the retry come back wrong.
  const bad = call({ answer: 'Claim 4471 was paid for $1,420.' });
  const transport = scriptedTransport([bad, bad]);
  const result = await runChaseWithEscalation(request(), {
    transport,
    atlas,
    now: '2026-09-08T12:00:00Z',
    fetchCall: async () => bad,
  });

  assert.equal(result.callsPlaced, 2, 'exactly two attempts, never three');
  assert.equal(result.escalated, true);
  assert.equal(result.attempts[0]?.mode, 'replay');
  assert.equal(result.attempts[1]?.mode, 'explore', 'the retry ignores the quarantined route');
  assert.ok(result.packet);
  assert.match(result.packet.reason, /not a stale route/);
});

test('a contradicted replay that succeeds on retry needs no human', async () => {
  const atlas = freshAtlas();
  await runChase(request(), { transport: scriptedTransport([call({ answer: GOOD_ANSWER })]), atlas, now: '2026-09-08T10:00:00Z' });

  const transport = scriptedTransport([
    call({ answer: 'Claim 4471 was paid for $1,420.' }),
    call({ answer: GOOD_ANSWER }),
  ]);
  const result = await runChaseWithEscalation(request(), { transport, atlas, now: '2026-09-08T12:00:00Z' });

  assert.equal(result.callsPlaced, 2);
  assert.equal(result.escalated, true);
  assert.equal(result.final.verification.verdict, 'verified');
  assert.equal(result.packet, undefined);
});

test('allowRetry false keeps the budget, at the cost of a second opinion', async () => {
  const atlas = freshAtlas();
  await runChase(request(), { transport: scriptedTransport([call({ answer: GOOD_ANSWER })]), atlas, now: '2026-09-08T10:00:00Z' });

  const transport = scriptedTransport([call({ answer: 'Claim 4471 was paid for $1,420.' })]);
  const result = await runChaseWithEscalation(request(), {
    transport, atlas, now: '2026-09-08T12:00:00Z', allowRetry: false,
  });

  assert.equal(result.callsPlaced, 1);
  assert.ok(result.packet);
});

test('the evidence packet carries what a person needs to judge it', async () => {
  const atlas = freshAtlas();
  const bad = call({ answer: 'Claim 4471 was paid for $1,420.' });
  const result = await runChaseWithEscalation(request(), {
    transport: scriptedTransport([bad]),
    atlas,
    now: '2026-09-08T10:00:00Z',
    fetchCall: async () => bad,
  });

  const text = renderPacket(result.packet!);
  assert.match(text, /NEEDS A PERSON/);
  assert.match(text, /numbers nobody said: 1420/);
  assert.match(text, /failed: numbers were spoken/);
  assert.match(text, /what they actually said/);
  assert.match(text, /Claim four four seven one/, 'the raw transcript is attached, not a summary of it');
});

test('an unreachable call asks a person about timing, not about the answer', async () => {
  const atlas = freshAtlas();
  const noAnswer: CallRecord = { id: 'call_x', status: 'no_answer', recipients: [] };
  const result = await runChaseWithEscalation(request(), {
    transport: scriptedTransport([noAnswer]),
    atlas,
    now: '2026-09-08T10:00:00Z',
  });

  assert.equal(result.callsPlaced, 1);
  assert.match(result.packet!.reason, /Nobody answered/);
  assert.match(result.packet!.reason, /try again later/);
});
