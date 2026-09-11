import { FIXTURE_KINDS, makeClaimFixture } from './fixtures.ts';
import { verifyClaimOutcome } from './verify.ts';

export interface EvaluationMetrics {
  cases: number;
  safeCases: number;
  unsafeCases: number;
  safeAccepted: number;
  unsafeAccepted: number;
  unsafeWithheld: number;
  safeAcceptanceRate: number;
  unsafeWithholdRate: number;
}

/** Seeded adversarial matrix: eight failure families, eighty claim variations each. */
export function evaluateCorpus(perFamily = 80): EvaluationMetrics {
  let safeCases = 0;
  let unsafeCases = 0;
  let safeAccepted = 0;
  let unsafeAccepted = 0;

  for (const kind of FIXTURE_KINDS) {
    for (let index = 0; index < perFamily; index++) {
      const fixture = makeClaimFixture(kind, index);
      const result = verifyClaimOutcome(fixture.input);
      if (fixture.expectedAutoAccept) {
        safeCases++;
        if (result.autoAccept) safeAccepted++;
      } else {
        unsafeCases++;
        if (result.autoAccept) unsafeAccepted++;
      }
    }
  }

  return {
    cases: safeCases + unsafeCases,
    safeCases,
    unsafeCases,
    safeAccepted,
    unsafeAccepted,
    unsafeWithheld: unsafeCases - unsafeAccepted,
    safeAcceptanceRate: safeCases ? safeAccepted / safeCases : 0,
    unsafeWithholdRate: unsafeCases ? (unsafeCases - unsafeAccepted) / unsafeCases : 0,
  };
}
