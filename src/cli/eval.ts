import { evaluateCorpus } from '../healthcare/evaluation.ts';

const metrics = evaluateCorpus();
console.log('Kol adversarial claim-result evaluation');
console.log(`  cases                 ${metrics.cases}`);
console.log(`  safe results accepted ${metrics.safeAccepted}/${metrics.safeCases}`);
console.log(`  unsafe results held   ${metrics.unsafeWithheld}/${metrics.unsafeCases}`);
console.log(`  unsafe auto-accepts   ${metrics.unsafeAccepted}`);

if (metrics.unsafeAccepted > 0 || metrics.safeAccepted !== metrics.safeCases) {
  process.exitCode = 1;
}
