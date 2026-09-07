import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractOptions, fingerprintSteps, normalisePrompt } from '../src/atlas/fingerprint.ts';
import { detectDrift } from '../src/atlas/drift.ts';
import { compileTask } from '../src/atlas/compile.ts';
import { Atlas } from '../src/atlas/store.ts';
import type { NavigationReport, Route } from '../src/atlas/types.ts';
import { maskE164, maskText } from '../src/util/mask.ts';

const MAIN_MENU =
  'Please listen carefully, as our menu options have recently changed. For member eligibility, ' +
  'press 1. For claims, press 2. For provider services, press 3.';

const MAIN_MENU_REWORDED =
  'Our options have changed. Press 1 for member eligibility. Press 2 for claims. Press 3 for provider services.';

const MAIN_MENU_REMAPPED =
  'For claims, press 3. For member eligibility, press 1. For provider services, press 2.';

function route(overrides: Partial<Route> = {}): Route {
  const steps = [
    { level: 1, heard: MAIN_MENU, action: { type: 'dtmf' as const, value: '2' } },
    {
      level: 2,
      heard: 'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.',
      action: { type: 'dtmf' as const, value: '1' },
    },
  ];
  return {
    lineE164: '+15550001111',
    org: 'Fixture Health Plan',
    goal: 'claim_status',
    targetName: 'claims',
    steps,
    fingerprint: fingerprintSteps(steps),
    version: 1,
    status: 'fresh',
    firstObservedAt: '2026-09-04T00:00:00Z',
    lastVerifiedAt: '2026-09-04T00:00:00Z',
    confirmations: 1,
    corrections: 0,
    ...overrides,
  };
}

function reportFrom(menus: string[], matched: NavigationReport['route_matched_expectation']): NavigationReport {
  return {
    reached_target: 'yes',
    target_name_used: 'claims',
    route_matched_expectation: matched,
    menu_levels: menus.map((prompt_heard, i) => ({
      level: i + 1,
      prompt_heard,
      action_type: 'dtmf' as const,
      action_value: i === 0 ? '2' : '1',
    })),
    final_answer: 'Claim 4471 was paid on August twelfth.',
  };
}

test('option extraction handles both menu phrasings and spoken digits', () => {
  const a = extractOptions(MAIN_MENU);
  assert.deepEqual(a, [
    { label: 'member eligibility', digit: '1' },
    { label: 'claims', digit: '2' },
    { label: 'provider services', digit: '3' },
  ]);

  const b = extractOptions(MAIN_MENU_REWORDED);
  assert.deepEqual(new Map(b.map((o) => [o.label, o.digit])), new Map(a.map((o) => [o.label, o.digit])));

  assert.deepEqual(extractOptions('For claims, press two.'), [{ label: 'claims', digit: '2' }]);
});

test('rewording the greeting is not drift, but remapping a key is', () => {
  const r = route();

  const unchanged = detectDrift(r, reportFrom([MAIN_MENU, r.steps[1]!.heard], 'yes'));
  assert.equal(unchanged.kind, 'none');
  assert.equal(unchanged.dangerous, false);

  const reworded = detectDrift(r, reportFrom([MAIN_MENU_REWORDED, r.steps[1]!.heard], 'yes'));
  assert.equal(reworded.kind, 'none', 'same option/key pairs, only prose differs');

  const remapped = detectDrift(r, reportFrom([MAIN_MENU_REMAPPED, r.steps[1]!.heard], 'no'));
  assert.equal(remapped.kind, 'remapped');
  assert.equal(remapped.dangerous, true);
  assert.match(remapped.summary, /"claims" moved from 2 to 3/);
});

test('a call that says the route did not match is drift even when prompts parse identically', () => {
  const r = route();
  const d = detectDrift(r, { ...reportFrom([MAIN_MENU, r.steps[1]!.heard], 'no'), reached_target: 'no' });
  assert.notEqual(d.kind, 'none');
  assert.equal(d.dangerous, true);
});

test('replay prose states the route and the condition for abandoning it', () => {
  const { task, mode } = compileTask({
    question: 'what is the status of claim 4471',
    targetName: 'claims',
    reference: '4471',
    route: route(),
  });

  assert.equal(mode, 'replay');
  assert.match(task, /At the first menu, press 2\./);
  assert.match(task, /At menu level 2, press 1\./);
  assert.match(task, /stop following these directions/i);
  assert.match(task, /automated assistant/i);
  assert.match(task, /If you are asked whether you are a real person, say no/i);
  assert.match(task, /Do not agree to anything/i);
  assert.match(task, /claim 4471/);
});

test('explore prose asks for the menu to be mapped and never invents a route', () => {
  const { task, mode } = compileTask({ question: 'what is the status of claim 4471', targetName: 'claims' });
  assert.equal(mode, 'explore');
  assert.doesNotMatch(task, /press 2/i);
  assert.match(task, /Listen to the whole menu/i);
  assert.match(task, /which key you pressed/i);
});

test('atlas learns, confirms, repairs and quarantines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kol-atlas-'));
  const atlas = new Atlas(join(dir, 'routes.json'));
  const base = { lineE164: '+15550001111', org: 'Fixture Health Plan', goal: 'claim_status', targetName: 'claims' };
  const second = 'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.';

  const learned = await atlas.record({
    ...base,
    report: reportFrom([MAIN_MENU, second], 'not_applicable'),
    now: '2026-09-04T10:00:00Z',
    holdSeconds: 140,
  });
  assert.equal(learned.outcome, 'learned');
  assert.equal(learned.route?.version, 1);

  const confirmed = await atlas.record({
    ...base,
    report: reportFrom([MAIN_MENU, second], 'yes'),
    now: '2026-09-04T11:00:00Z',
    holdSeconds: 40,
  });
  assert.equal(confirmed.outcome, 'confirmed');
  assert.equal(confirmed.route?.confirmations, 2);
  assert.equal(confirmed.route?.version, 1, 'confirmation must not bump the version');

  const repaired = await atlas.record({
    ...base,
    report: reportFrom([MAIN_MENU_REMAPPED, second], 'no'),
    now: '2026-09-04T12:00:00Z',
  });
  assert.equal(repaired.outcome, 'repaired');
  assert.equal(repaired.route?.version, 2);
  assert.equal(repaired.route?.corrections, 1);
  assert.equal(repaired.route?.confirmations, 1, 'a repaired route starts earning trust again');

  const quarantined = await atlas.record({
    ...base,
    report: { reached_target: 'unclear', menu_levels: [] },
    now: '2026-09-04T13:00:00Z',
  });
  assert.equal(quarantined.outcome, 'quarantined');
  assert.equal(quarantined.route?.status, 'stale');
});

test('a first call that never reached the target is not learned as a route', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kol-atlas-fail-'));
  const atlas = new Atlas(join(dir, 'routes.json'));
  const res = await atlas.record({
    lineE164: '+15550002222',
    org: 'Fixture Health Plan',
    goal: 'claim_status',
    targetName: 'claims',
    report: { reached_target: 'no', menu_levels: [{ level: 1, prompt_heard: MAIN_MENU, action_type: 'dtmf', action_value: '2' }] },
    now: '2026-09-04T10:00:00Z',
  });
  assert.equal(res.outcome, 'quarantined');
  assert.equal(atlas.all().length, 0);
});

test('phone numbers are masked in text and in structured payloads', () => {
  assert.equal(maskE164('+919876543210'), '+91•••••••210');
  assert.match(maskText('call +15550001111 back'), /call \+15.*111 back/);
  assert.doesNotMatch(maskText('call +15550001111 back'), /5550001/);
});

test('normalisePrompt strips carrier filler so it cannot cause false drift', () => {
  assert.doesNotMatch(normalisePrompt(MAIN_MENU), /listen carefully|options have recently changed/);
});
