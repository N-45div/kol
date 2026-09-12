import { evaluateBatchCorpus, evaluateCorpus } from '../healthcare/evaluation.ts';

const single = evaluateCorpus();
const batch = evaluateBatchCorpus();

console.log('Kol adversarial claim-result evaluation');
console.log('  single claim per call (9 families)');
console.log(`    cases                 ${single.cases}`);
console.log(`    safe results accepted ${single.safeAccepted}/${single.safeCases}`);
console.log(`    unsafe results held   ${single.unsafeWithheld}/${single.unsafeCases}`);
console.log(`    unsafe auto-accepts   ${single.unsafeAccepted}`);
console.log('  several claims per call (5 families, scored per claim)');
console.log(`    claim verdicts        ${batch.cases}`);
console.log(`    safe claims accepted  ${batch.safeAccepted}/${batch.safeCases}`);
console.log(`    unsafe claims held    ${batch.unsafeWithheld}/${batch.unsafeCases}`);
console.log(`    unsafe auto-accepts   ${batch.unsafeAccepted}`);

for (const m of [single, batch]) {
  if (m.unsafeAccepted > 0 || m.safeAccepted !== m.safeCases) process.exitCode = 1;
}
