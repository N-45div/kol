import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCorpus } from '../src/healthcare/evaluation.ts';
import { FIXTURE_KINDS, makeClaimFixture } from '../src/healthcare/fixtures.ts';
import { verifyClaimOutcome } from '../src/healthcare/verify.ts';

for (const kind of FIXTURE_KINDS) {
  test(`claim witness gate: ${kind}`, () => {
    const fixture = makeClaimFixture(kind, 17);
    const result = verifyClaimOutcome(fixture.input);
    assert.equal(result.autoAccept, fixture.expectedAutoAccept);
    if (fixture.expectedAutoAccept) assert.equal(result.verdict, 'verified');
  });
}

test('wrong department is contradicted even when every financial number matches', () => {
  const fixture = makeClaimFixture('wrong_department', 19);
  const result = verifyClaimOutcome(fixture.input);
  assert.equal(result.verdict, 'contradicted');
  assert.equal(result.checks.find((check) => check.name === 'paid amount supported')?.passed, true);
  assert.equal(result.checks.find((check) => check.name === 'claims department established')?.passed, false);
});

test('a result is withheld when the agent never asked the question', () => {
  const result = verifyClaimOutcome(makeClaimFixture('never_asked', 21).input);
  assert.equal(result.autoAccept, false);
  assert.equal(result.checks.find((check) => check.name === 'question was actually asked')?.passed, false);
});

test('a model-reported route cannot substitute for an independent receipt', () => {
  const result = verifyClaimOutcome(makeClaimFixture('missing_route_receipt', 23).input);
  assert.equal(result.autoAccept, false);
  assert.equal(result.checks.find((check) => check.name === 'independent route receipt')?.passed, false);
});

test('claim references preserve leading zeroes and cannot collide with an amount', () => {
  const fixture = makeClaimFixture('clean_paid', 25);
  fixture.input.expectedClaimReference = '004425';
  fixture.input.outcome.claimReference = '4425';
  const result = verifyClaimOutcome(fixture.input);
  assert.equal(result.autoAccept, false);
  assert.equal(result.checks.find((check) => check.name === 'claim reference bound')?.passed, false);
});

test('a returned payment year must be present in payer evidence', () => {
  const fixture = makeClaimFixture('clean_paid', 26);
  fixture.input.outcome.paymentDate = '2025-08-12';
  const result = verifyClaimOutcome(fixture.input);
  assert.equal(result.autoAccept, false);
  assert.equal(result.checks.find((check) => check.name === 'payment date supported')?.passed, false);
});

test('the seeded 720-case matrix has zero unsafe auto-accepts', () => {
  const metrics = evaluateCorpus();
  assert.equal(metrics.cases, 720);
  assert.equal(metrics.safeAccepted, 160);
  assert.equal(metrics.unsafeWithheld, 560);
  assert.equal(metrics.unsafeAccepted, 0);
});

test('provider evidence that narrates an amount nobody said blocks auto-accept', () => {
  const result = verifyClaimOutcome(makeClaimFixture('provider_evidence_unsupported', 27).input);
  assert.equal(result.autoAccept, false);
  assert.equal(result.verdict, 'needs_review', 'the payer fields themselves are fine; the provider narration is not');
  const check = result.checks.find((c) => c.name === 'provider evidence cross-examined')!;
  assert.equal(check.passed, false);
  assert.match(check.detail, /never said/);
});

test('provider evidence that agrees with the payer changes nothing', () => {
  const result = verifyClaimOutcome(makeClaimFixture('clean_paid', 28).input);
  assert.equal(result.autoAccept, true);
  assert.equal(result.checks.find((c) => c.name === 'provider evidence cross-examined')!.passed, true);
});
