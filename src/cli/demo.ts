import { verifyClaimBatch } from '../healthcare/batch.ts';
import { makeBatchFixture } from '../healthcare/batch-fixtures.ts';
import { makeClaimFixture, type FixtureKind } from '../healthcare/fixtures.ts';
import { verifyClaimOutcome } from '../healthcare/verify.ts';

const scenes: { kind: FixtureKind; title: string }[] = [
  { kind: 'clean_paid', title: 'Verified payer result' },
  { kind: 'wrong_department', title: 'Correctly-shaped answer from the wrong desk' },
  { kind: 'route_mismatch', title: 'Cached IVR route changed underneath the call' },
];

console.log('');
console.log('KOL — verified payer-call operations');
console.log('Replay fixture only. No phone call is placed. All claims and payers are fictional.');

for (const [index, scene] of scenes.entries()) {
  const fixture = makeClaimFixture(scene.kind, index + 7);
  const verification = verifyClaimOutcome(fixture.input);
  console.log('');
  console.log(`${index + 1}. ${scene.title}`);
  console.log(`   verdict: ${verification.verdict.toUpperCase()}`);
  for (const check of verification.checks) {
    const marker = check.passed ? 'ok  ' : check.severity === 'required' ? 'FAIL' : 'note';
    console.log(`   ${marker} ${check.name}: ${check.detail}`);
  }
  console.log(`   ${verification.summary}`);
}

const batch = verifyClaimBatch(makeBatchFixture('batch_crossed', 11).input);
console.log('');
console.log('4. Three claims on one call, one answer filed under the wrong claim');
console.log(`   ${batch.summary}`);
for (const entry of batch.claims) {
  const binding = entry.bindingChecks.find((check) => check.name === 'answer bound to this claim');
  console.log(`   claim ${entry.claimReference}: ${entry.verification.verdict.toUpperCase()}${binding && !binding.passed ? ` — ${binding.detail}` : ''}`);
}

console.log('');
console.log('Next: npm run eval for the complete adversarial matrices.');
