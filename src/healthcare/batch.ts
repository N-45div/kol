import type { CallRecord } from '../calle/types.ts';
import { numbersIn } from '../chase/numbers.ts';
import type { ClaimOutcome, ClaimVerification, RouteReceipt, WitnessCheck } from './types.ts';
import { verifyClaimOutcome } from './verify.ts';

/**
 * Several claims, one call.
 *
 * A biller with six open claims at one payer does not place six calls; they get through the
 * tree once and read the claim numbers off a list. That is the cheapest thing Kol can do for
 * them, and it opens a failure the single-claim gate cannot see: the representative answers
 * all six correctly, and the model files claim B's amount under claim A. Every number was
 * spoken. Every quote is real. Only the binding is wrong.
 *
 * So in a batch, each answer must be bound to its own claim by the payer's words: the quote
 * that supports claim A has to say "4401" in it. A quote that names a different claim on the
 * list is a crossed answer and contradicts the result. A quote that names none is ambiguous
 * and goes to a person. Claims the call was never asked about are invented and contradicted;
 * claims that were asked and never answered are simply held.
 */

export interface ClaimBatchInput {
  call: CallRecord;
  /** One outcome per claim the model reports on. Order does not matter. */
  outcomes: ClaimOutcome[];
  /** The claims the operator actually asked about. */
  expectedClaimReferences: string[];
  expectedDepartment?: string;
  reportedKeys: string[];
  routeReceipt?: RouteReceipt;
  minConfidence?: number;
}

export interface ClaimBatchEntry {
  claimReference: string;
  verification: ClaimVerification;
  /** Checks that only make sense when more than one claim shares a transcript. */
  bindingChecks: WitnessCheck[];
}

export interface ClaimBatchVerification {
  claims: ClaimBatchEntry[];
  autoAccepted: number;
  held: number;
  contradicted: number;
  summary: string;
}

/** Ask for every claim in one breath, and make the representative name each claim as they answer. */
export function batchQuestion(references: string[]): string {
  if (references.length === 1) return `what is the current status of claim ${references[0]}`;
  const list = `${references.slice(0, -1).join(', ')} and ${references.at(-1)}`;
  return (
    `what is the current status of each of these claims: ${list}. Ask about them one at a ` +
    'time, and ask the representative to say the claim number together with each answer so ' +
    'that every answer is clearly tied to its claim'
  );
}

export function verifyClaimBatch(input: ClaimBatchInput): ClaimBatchVerification {
  const expected = new Map(input.expectedClaimReferences.map((ref) => [canonical(ref), ref]));
  const claims: ClaimBatchEntry[] = [];
  const seen = new Set<string>();

  for (const outcome of input.outcomes) {
    const ref = canonical(outcome.claimReference);
    const bindingChecks: WitnessCheck[] = [];

    if (!expected.has(ref)) {
      // Nobody asked. The single-claim gate would happily verify a well-supported answer to a
      // question that was never on the list, so this is decided here.
      bindingChecks.push(required('claim was requested', false, `the result reports claim ${masked(ref)}, which was not on the list`));
      claims.push({ claimReference: outcome.claimReference, bindingChecks, verification: contradictedEntry(bindingChecks, 'The call reported a claim nobody asked about. It cannot enter any record.') });
      continue;
    }
    if (seen.has(ref)) {
      bindingChecks.push(required('claim reported once', false, `claim ${masked(ref)} appears more than once in the result`));
      claims.push({ claimReference: outcome.claimReference, bindingChecks, verification: contradictedEntry(bindingChecks, 'Two answers for one claim. Neither can be trusted over the other.') });
      continue;
    }
    seen.add(ref);

    const single = verifyClaimOutcome({
      call: input.call,
      outcome,
      expectedClaimReference: outcome.claimReference,
      ...(input.expectedDepartment ? { expectedDepartment: input.expectedDepartment } : {}),
      reportedKeys: input.reportedKeys,
      ...(input.routeReceipt ? { routeReceipt: input.routeReceipt } : {}),
      ...(input.minConfidence !== undefined ? { minConfidence: input.minConfidence } : {}),
    });

    const quote = outcome.evidence.answer;
    const othersNamed = [...expected.keys()].filter((other) => other !== ref && referenceNamed(quote, other));
    const selfNamed = referenceNamed(quote, ref);

    let verification = single;
    if (input.outcomes.length > 1 || input.expectedClaimReferences.length > 1) {
      if (othersNamed.length > 0) {
        bindingChecks.push(required('answer bound to this claim', false,
          `the supporting quote names claim ${othersNamed.map(masked).join(' and ')}, not ${masked(ref)}: a crossed answer`));
        verification = contradictedEntry([...single.checks, ...bindingChecks], `The quote filed under claim ${masked(ref)} is the payer's answer about a different claim. Do not write it.`);
      } else if (!selfNamed) {
        bindingChecks.push(required('answer bound to this claim', false,
          `the supporting quote does not say which claim it answers; with ${input.expectedClaimReferences.length} claims on the call a person must bind it`));
        if (verification.verdict === 'verified') {
          verification = { verdict: 'needs_review', autoAccept: false, checks: [...single.checks, ...bindingChecks], summary: 'Every witness agrees except the binding: the payer did not name the claim in this answer.' };
        } else {
          verification = { ...verification, checks: [...single.checks, ...bindingChecks] };
        }
      } else {
        bindingChecks.push(required('answer bound to this claim', true, `the payer named claim ${masked(ref)} in the answer`));
        verification = { ...verification, checks: [...single.checks, ...bindingChecks] };
      }
    }

    claims.push({ claimReference: outcome.claimReference, verification, bindingChecks });
  }

  for (const [ref, original] of expected) {
    if (seen.has(ref)) continue;
    const bindingChecks = [required('answer returned for this claim', false, `claim ${masked(ref)} was asked about and never answered`)];
    claims.push({
      claimReference: original,
      bindingChecks,
      verification: { verdict: 'needs_review', autoAccept: false, checks: bindingChecks, summary: 'No answer came back for this claim. Ask again; nothing is written.' },
    });
  }

  const autoAccepted = claims.filter((c) => c.verification.autoAccept).length;
  const contradicted = claims.filter((c) => c.verification.verdict === 'contradicted').length;
  const held = claims.length - autoAccepted;
  return {
    claims,
    autoAccepted,
    held,
    contradicted,
    summary: `${claims.length} claims on one call: ${autoAccepted} verified, ${held} held${contradicted ? ` (${contradicted} contradicted)` : ''}. Each claim stands on its own witnesses.`,
  };
}

function contradictedEntry(checks: WitnessCheck[], summary: string): ClaimVerification {
  return { verdict: 'contradicted', autoAccept: false, checks, summary };
}

function required(name: string, passed: boolean, detail: string): WitnessCheck {
  return { name, passed, severity: 'required', detail };
}

function canonical(reference: string): string {
  return reference.replace(/\D/g, '');
}

/** The reference as digits, spoken digits, or a number, anywhere in the quote. */
function referenceNamed(quote: string, reference: string): boolean {
  if (!reference) return false;
  const runs = quote.match(/\d(?:[\d\s-]*\d)?/g) ?? [];
  if (runs.some((run) => run.replace(/\D/g, '') === reference)) return true;
  return !reference.startsWith('0') && numbersIn(quote).has(String(Number(reference)));
}

function masked(reference: string): string {
  return reference.length <= 4 ? reference : `${'•'.repeat(reference.length - 4)}${reference.slice(-4)}`;
}
