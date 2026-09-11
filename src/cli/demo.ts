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

console.log('');
console.log('Next: npm run eval for the complete 640-case adversarial matrix.');
