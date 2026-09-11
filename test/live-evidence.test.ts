import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicCallState, type ProviderCall } from '../web/lib/live-evidence.ts';

function call(overrides: Partial<ProviderCall> = {}): ProviderCall {
  return {
    id: 'call_demo123456',
    status: 'completed',
    metadata: { kol_scenario: 'authorised-product-smoke-test' },
    structured_result: { test_phrase_heard: false, exact_phrase: '' },
    recipients: [{
      status: 'completed',
      attempts: [{ transcript_turns: [
        { offset_seconds: 1, speaker: 'bot', text: 'Please say Kol test received.' },
        { offset_seconds: 4, speaker: 'user', text: 'Kol test received!' },
      ] }],
    }],
    ...overrides,
  };
}

test('grounds the smoke phrase in recipient transcript when structured extraction is false', () => {
  const state = buildPublicCallState(call());
  assert.equal(state.phraseHeard, true);
  assert.equal(state.verdict, 'verified');
  assert.equal(state.checks[1]?.passed, true);
});

test('does not accept the phrase from the agent side', () => {
  const source = call();
  source.recipients![0]!.attempts![0]!.transcript_turns = [
    { offset_seconds: 1, speaker: 'bot', text: 'Kol test received.' },
    { offset_seconds: 4, speaker: 'user', text: 'Okay.' },
  ];
  const state = buildPublicCallState(source);
  assert.equal(state.phraseHeard, false);
  assert.equal(state.verdict, 'needs_review');
});

test('grounds every fictional claim field but withholds without an independent route witness', () => {
  const source = call({
    metadata: { kol_scenario: 'fictional-claim-evidence-demo' },
    structured_result: {
      target_name_used: 'Claims status department',
      claim_reference: '4471',
      claim_status: 'paid',
      paid_amount: '$1,240',
      payment_date: '2026-08-12',
    },
  });
  source.recipients![0]!.attempts![0]!.transcript_turns = [
    { offset_seconds: 1, speaker: 'bot', text: 'What is the current status of claim 4471?' },
    { offset_seconds: 4, speaker: 'user', text: 'This is the claims status department.' },
    { offset_seconds: 7, speaker: 'user', text: 'Claim four four seven one was paid one thousand two hundred forty dollars on August twelfth, twenty twenty six.' },
  ];
  const state = buildPublicCallState(source);
  assert.equal(state.verdict, 'needs_review');
  assert.equal(state.checks.slice(0, -1).every((item) => item.passed), true);
  assert.equal(state.checks.at(-1)?.label, 'Independent route receipt');
  assert.equal(state.checks.at(-1)?.passed, false);
});

test('contradicts a live claim whose amount does not match transcript evidence', () => {
  const source = call({
    metadata: { kol_scenario: 'fictional-claim-evidence-demo' },
    structured_result: {
      target_name_used: 'Claims status department', claim_reference: '4471', claim_status: 'paid', paid_amount: '$1,420', payment_date: '2026-08-12',
    },
  });
  source.recipients![0]!.attempts![0]!.transcript_turns = [
    { offset_seconds: 1, speaker: 'bot', text: 'What is the current status of claim 4471?' },
    { offset_seconds: 4, speaker: 'user', text: 'This is the claims status department. Claim 4471 was paid $1,240 on August 12, 2026.' },
  ];
  assert.equal(buildPublicCallState(source).verdict, 'contradicted');
});

test('keeps queued calls in processing state without inventing evidence', () => {
  const state = buildPublicCallState(call({ status: 'queued', recipients: [] }));
  assert.equal(state.verdict, 'processing');
  assert.equal(state.transcriptTurns, 0);
  assert.deepEqual(state.checks, []);
});
