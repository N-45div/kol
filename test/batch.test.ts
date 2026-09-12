import test from 'node:test';
import assert from 'node:assert/strict';

import { batchQuestion, verifyClaimBatch } from '../src/healthcare/batch.ts';
import { BATCH_FIXTURE_KINDS, makeBatchFixture } from '../src/healthcare/batch-fixtures.ts';
import { evaluateBatchCorpus } from '../src/healthcare/evaluation.ts';
import { verifyClaimOutcome } from '../src/healthcare/verify.ts';

function entry(kind: Parameters<typeof makeBatchFixture>[0], ref: number, index = 5) {
  const fixture = makeBatchFixture(kind, index);
  const batch = verifyClaimBatch(fixture.input);
  const reference = fixture.input.expectedClaimReferences[ref]!;
  return { fixture, batch, claim: batch.claims.find((c) => c.claimReference === reference)! };
}

for (const kind of BATCH_FIXTURE_KINDS) {
  test(`batch gate: every claim in ${kind} lands where the fixture says`, () => {
    const fixture = makeBatchFixture(kind, 9);
    const batch = verifyClaimBatch(fixture.input);
    for (const [reference, expected] of Object.entries(fixture.expectedAutoAccept)) {
      const claim = batch.claims.find((c) => c.claimReference === reference);
      assert.ok(claim, `claim ${reference} has a verdict`);
      assert.equal(claim.verification.autoAccept, expected, `${reference}: ${claim.verification.summary}`);
    }
  });
}

test('three clean claims on one call each verify on their own witnesses', () => {
  const { batch } = entry('batch_clean', 0);
  assert.equal(batch.autoAccepted, 3);
  assert.equal(batch.held, 0);
  assert.match(batch.summary, /3 verified/);
});

test('a crossed answer passes the single-claim gate and is caught only by binding', () => {
  const { fixture, claim } = entry('batch_crossed', 0);
  const crossed = fixture.input.outcomes[0]!;

  // Every number in the swapped result was really spoken, so the single-claim verifier is
  // satisfied. That is precisely the gap.
  const alone = verifyClaimOutcome({
    call: fixture.input.call,
    outcome: crossed,
    expectedClaimReference: crossed.claimReference,
    expectedDepartment: 'claims status department',
    reportedKeys: ['2', '1'],
    routeReceipt: { source: 'fixture_log', keys: ['2', '1'] },
  });
  assert.equal(alone.autoAccept, true, 'the single-claim gate cannot see a swapped binding');

  assert.equal(claim.verification.verdict, 'contradicted');
  const binding = claim.bindingChecks.find((c) => c.name === 'answer bound to this claim')!;
  assert.equal(binding.passed, false);
  assert.match(binding.detail, /crossed answer/);
});

test('the other claims on a call with one crossed answer are unaffected', () => {
  const { batch } = entry('batch_crossed', 1);
  assert.equal(batch.autoAccepted, 2);
  assert.equal(batch.contradicted, 1);
});

test('a claim nobody asked about is contradicted however well its quote is grounded', () => {
  const fixture = makeBatchFixture('batch_invented', 3);
  const batch = verifyClaimBatch(fixture.input);
  const ghost = batch.claims.find((c) => !fixture.input.expectedClaimReferences.includes(c.claimReference))!;
  assert.equal(ghost.verification.verdict, 'contradicted');
  assert.match(ghost.verification.summary, /nobody asked/);
});

test('a claim that was asked and never answered is held, not invented', () => {
  const { claim, batch } = entry('batch_unanswered', 2);
  assert.equal(claim.verification.verdict, 'needs_review');
  assert.match(claim.verification.summary, /No answer came back/);
  assert.equal(batch.autoAccepted, 2);
});

test('a real quote that names no claim is ambiguous on a multi-claim call', () => {
  const { claim } = entry('batch_ambiguous', 0);
  assert.equal(claim.verification.verdict, 'needs_review');
  assert.match(claim.verification.summary, /did not name the claim/);
});

test('the same answer reported twice for one claim is contradicted', () => {
  const fixture = makeBatchFixture('batch_clean', 4);
  fixture.input.outcomes.push({ ...fixture.input.outcomes[0]! });
  const batch = verifyClaimBatch(fixture.input);
  const dupes = batch.claims.filter((c) => c.claimReference === fixture.input.expectedClaimReferences[0]);
  assert.equal(dupes.length, 2);
  assert.ok(dupes.some((c) => c.verification.verdict === 'contradicted'));
});

test('a single-claim batch behaves exactly like the single-claim gate', () => {
  const fixture = makeBatchFixture('batch_clean', 6);
  const only = fixture.input.outcomes[0]!;
  const batch = verifyClaimBatch({ ...fixture.input, outcomes: [only], expectedClaimReferences: [only.claimReference] });
  assert.equal(batch.claims.length, 1);
  assert.equal(batch.claims[0]!.verification.autoAccept, true);
  assert.equal(batch.claims[0]!.bindingChecks.length, 0, 'binding is only demanded when claims share a call');
});

test('the batch question makes the representative name each claim', () => {
  const question = batchQuestion(['4401', '4402', '4403']);
  assert.match(question, /4401, 4402 and 4403/);
  assert.match(question, /say the claim number together with each answer/);
  assert.equal(batchQuestion(['4401']), 'what is the current status of claim 4401');
});

test('the seeded multi-claim matrix has zero unsafe auto-accepts', () => {
  const metrics = evaluateBatchCorpus();
  assert.equal(metrics.cases, 80 * (3 + 3 + 4 + 3 + 3));
  assert.equal(metrics.unsafeAccepted, 0);
  assert.equal(metrics.safeAccepted, metrics.safeCases);
});
