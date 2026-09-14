import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPublicCallState, type ProviderCall } from '../web/lib/live-evidence.ts';

/**
 * A finished claim-evidence call whose payer side is phrased the way a phone line actually
 * transcribes speech: digits read one by one, amounts in words, dates in either order.
 */
function claimCall(payer: [string, string], extracted: Record<string, unknown> = {}): ProviderCall {
  return {
    id: 'call_claim_spoken_0001',
    status: 'completed',
    metadata: { kol_scenario: 'fictional-claim-evidence-demo' },
    structured_result: {
      target_name_used: 'Claims status department',
      claim_reference: '4471',
      claim_status: 'paid',
      paid_amount: '$1,240',
      payment_date: 'August 12, 2026',
      ...extracted,
    },
    recipients: [{
      status: 'completed',
      attempts: [{ transcript_turns: [
        { offset_seconds: 0, speaker: 'bot', text: 'Hello, this is Kol, an automated assistant running a fictional claim-status demonstration.' },
        { offset_seconds: 5, speaker: 'bot', text: 'Are you speaking for the Claims status department?' },
        { offset_seconds: 8, speaker: 'user', text: payer[0] },
        { offset_seconds: 12, speaker: 'bot', text: 'What is the current status of fictional claim four, four, seven, one?' },
        { offset_seconds: 18, speaker: 'user', text: payer[1] },
      ] }],
    }],
  };
}

function onlyRouteMissing(state: ReturnType<typeof buildPublicCallState>) {
  const failed = state.checks.filter((c) => !c.passed).map((c) => c.label);
  assert.deepEqual(failed, ['Independent route receipt'], `unexpected failures: ${failed.join(', ')}`);
  assert.equal(state.verdict, 'needs_review');
}

test('digits read one by one, an amount in words, and a spoken date are all grounded', () => {
  onlyRouteMissing(buildPublicCallState(claimCall([
    'Yes, this is the claims status department.',
    'Claim four four seven one was paid one thousand two hundred forty dollars on August twelfth, twenty twenty six.',
  ])));
});

test('a day-first date and a singular "claim status department" are grounded', () => {
  onlyRouteMissing(buildPublicCallState(claimCall([
    "Yes, this is the claim status department.",
    'Claim 4471 was paid $1,240 on 12 August 2026.',
  ])));
});

test('paired digits, "twelve hundred and forty", and "the twelfth of August" are grounded', () => {
  onlyRouteMissing(buildPublicCallState(claimCall([
    'Claims status department, how can I help you?',
    'Claim forty-four seventy-one was paid twelve hundred and forty dollars on the twelfth of August, two thousand and twenty six.',
  ])));
});

test('tolerance does not make a wrong amount pass', () => {
  const state = buildPublicCallState(claimCall([
    'Yes, this is the claims status department.',
    'Claim four four seven one was paid one thousand four hundred twenty dollars on August twelfth, twenty twenty six.',
  ]));
  assert.equal(state.verdict, 'contradicted');
  assert.equal(state.checks.find((c) => c.label === 'Amount witness')!.passed, false);
});

test('tolerance does not make the wrong desk pass', () => {
  const state = buildPublicCallState(claimCall([
    'No, this is provider services.',
    'Claim 4471 was paid $1,240 on August 12, 2026.',
  ]));
  assert.equal(state.verdict, 'contradicted');
  assert.equal(state.checks.find((c) => c.label === 'Destination witness')!.passed, false);
});

test('a different claim number spoken by the payer is not grounded', () => {
  const state = buildPublicCallState(claimCall([
    'Yes, this is the claims status department.',
    'Claim four four seven two was paid $1,240 on August 12, 2026.',
  ]));
  assert.equal(state.checks.find((c) => c.label === 'Claim reference')!.passed, false);
  assert.equal(state.verdict, 'contradicted');
});
