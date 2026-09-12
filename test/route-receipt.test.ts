import test from 'node:test';
import assert from 'node:assert/strict';

import { applyRouteReceipt, buildPublicCallState, ROUTE_DEMO, type ProviderCall } from '../web/lib/live-evidence.ts';

/** A finished IVR-route call as the API returns it, with the model reporting the given keys. */
function routeCall(opts: { keys?: string[]; menus?: boolean; question?: boolean } = {}): ProviderCall {
  const keys = opts.keys ?? [...ROUTE_DEMO.keys];
  const turns = [
    { offset_seconds: 0, speaker: 'bot', text: 'Hello, this is Kol, an automated assistant running a fictional phone-menu demonstration.' },
    { offset_seconds: 4, speaker: 'user', text: opts.menus === false ? 'Hello?' : ROUTE_DEMO.menus[0] },
    { offset_seconds: 14, speaker: 'user', text: opts.menus === false ? 'Who is this?' : ROUTE_DEMO.menus[1] },
    { offset_seconds: 22, speaker: 'user', text: 'This is the claims status department.' },
    { offset_seconds: 26, speaker: 'bot', text: opts.question === false ? 'Thank you, goodbye.' : 'What is the current status of fictional claim 4471?' },
    { offset_seconds: 31, speaker: 'user', text: 'Claim 4471 was paid $1,240 on August 12, 2026.' },
  ];
  return {
    id: 'call_route_test_0001',
    status: 'completed',
    metadata: { kol_scenario: 'fictional-ivr-route-demo' },
    structured_result: {
      reached_target: 'yes',
      target_name_used: 'claims status department',
      menu_levels: keys.map((key, index) => ({ level: index + 1, prompt_heard: ROUTE_DEMO.menus[index] ?? '', action_type: 'dtmf', action_value: key })),
      claim_reference: '4471',
      claim_status: 'paid',
      paid_amount: '$1,240',
      payment_date: 'August 12, 2026',
    },
    recipients: [{ status: 'completed', attempts: [{ transcript_turns: turns }] }],
  };
}

test('a replayed route with only the model as witness stays under review', () => {
  const state = buildPublicCallState(routeCall());
  assert.equal(state.scenario, 'ivr_route');
  assert.deepEqual(state.reportedRoute, ['2', '1']);
  assert.equal(state.verdict, 'needs_review');
  const receipt = state.checks.find((c) => c.label === 'Independent route receipt')!;
  assert.equal(receipt.passed, false);
  assert.match(receipt.detail, /No independent account/);
});

test('an operator-attested receipt that agrees verifies the route', () => {
  const state = applyRouteReceipt(buildPublicCallState(routeCall()), '2, 1');
  assert.equal(state.verdict, 'verified');
  assert.deepEqual(state.routeReceipt?.keys, ['2', '1']);
  assert.match(state.routeReceipt!.note, /weaker than a fixture log/);
  assert.ok(state.checks.every((c) => c.passed));
});

test('a receipt that disagrees contradicts the route, whatever the model reported', () => {
  const state = applyRouteReceipt(buildPublicCallState(routeCall()), '2 3');
  assert.equal(state.verdict, 'contradicted');
  const receipt = state.checks.find((c) => c.label === 'Independent route receipt')!;
  assert.equal(receipt.passed, false);
  assert.match(receipt.detail, /quarantined/);
});

test('hearing no keys at all is a finding, not a pass', () => {
  const state = applyRouteReceipt(buildPublicCallState(routeCall()), '');
  assert.equal(state.verdict, 'contradicted');
  assert.deepEqual(state.routeReceipt?.keys, []);
});

test('a model that strayed from the compiled route fails before any receipt', () => {
  const state = buildPublicCallState(routeCall({ keys: ['3', '1'] }));
  assert.equal(state.verdict, 'contradicted');
  assert.equal(state.checks.find((c) => c.label === 'Replay followed the atlas')!.passed, false);
});

test('a model that never pressed keys is called out', () => {
  const state = buildPublicCallState(routeCall({ keys: [] }));
  assert.equal(state.verdict, 'contradicted');
  assert.match(state.checks.find((c) => c.label === 'Route reported')!.detail, /spoken to the menu/);
});

test('menus the recipient never read cannot be replayed', () => {
  const state = buildPublicCallState(routeCall({ menus: false }));
  assert.equal(state.checks.find((c) => c.label === 'Menu witness')!.passed, false);
  assert.equal(state.verdict, 'contradicted');
});

test('the receipt is ignored for calls that are not a finished route replay', () => {
  const pending = buildPublicCallState({ ...routeCall(), status: 'in_progress' });
  assert.equal(pending.verdict, 'processing');
  assert.equal(applyRouteReceipt(pending, '2 1'), pending);
});

test('the receipt never mutates the state it was given', () => {
  const before = buildPublicCallState(routeCall());
  const snapshot = JSON.stringify(before);
  applyRouteReceipt(before, '2 1');
  assert.equal(JSON.stringify(before), snapshot);
});
