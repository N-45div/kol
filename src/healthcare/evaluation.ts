import { verifyClaimBatch } from './batch.ts';
import { BATCH_FIXTURE_KINDS, makeBatchFixture } from './batch-fixtures.ts';
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

/** Seeded adversarial matrix: nine failure families, eighty claim variations each. */
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

  return metrics(safeCases, unsafeCases, safeAccepted, unsafeAccepted);
}

function metrics(safeCases: number, unsafeCases: number, safeAccepted: number, unsafeAccepted: number): EvaluationMetrics {
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

/**
 * Multi-claim matrix: five families, eighty calls each, three or four claims per call. Every
 * claim on every call is scored on its own.
 */
export function evaluateBatchCorpus(perFamily = 80): EvaluationMetrics {
  let safeCases = 0;
  let unsafeCases = 0;
  let safeAccepted = 0;
  let unsafeAccepted = 0;

  for (const kind of BATCH_FIXTURE_KINDS) {
    for (let index = 0; index < perFamily; index++) {
      const fixture = makeBatchFixture(kind, index);
      const batch = verifyClaimBatch(fixture.input);
      for (const entry of batch.claims) {
        const expected = fixture.expectedAutoAccept[entry.claimReference] ?? false;
        if (expected) {
          safeCases++;
          if (entry.verification.autoAccept) safeAccepted++;
        } else {
          unsafeCases++;
          if (entry.verification.autoAccept) unsafeAccepted++;
        }
      }
    }
  }

  return metrics(safeCases, unsafeCases, safeAccepted, unsafeAccepted);
}
