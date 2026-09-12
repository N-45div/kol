import { allTurns, calleeTurns, type CallRecord } from '../calle/types.ts';
import { numbersIn } from '../chase/numbers.ts';
import type {
  ClaimOutcome,
  ClaimVerification,
  RouteReceipt,
  WitnessCheck,
} from './types.ts';

const STATUS_WORDS: Record<ClaimOutcome['status'], string[]> = {
  paid: ['paid', 'payment issued', 'processed for payment'],
  pending: ['pending', 'in process', 'under review'],
  denied: ['denied', 'denial'],
  rejected: ['rejected', 'rejection'],
  needs_information: ['needs information', 'additional information', 'missing information'],
  not_found: ['not found', 'no record', 'cannot locate'],
  unknown: ['unknown', 'unable to determine', 'could not confirm'],
};

export interface VerifyClaimInput {
  call: CallRecord;
  outcome: ClaimOutcome;
  expectedClaimReference: string;
  expectedDepartment?: string;
  reportedKeys: string[];
  routeReceipt?: RouteReceipt;
  minConfidence?: number;
}

/**
 * Verify a healthcare claim result without asking one model to grade another.
 * Every required check is deterministic and can only reduce trust.
 */
export function verifyClaimOutcome(input: VerifyClaimInput): ClaimVerification {
  const checks: WitnessCheck[] = [];
  const callStatus = String(input.call.status ?? '').toLowerCase();
  const payerTurns = calleeTurns(input.call);
  const agentTurns = allTurns(input.call).filter((turn) => turn.speaker === 'bot');
  const payerText = payerTurns.map((turn) => turn.text).join(' ');
  const agentText = agentTurns.map((turn) => turn.text).join(' ');
  const confidence = input.call.completion_confidence?.score;
  const minConfidence = input.minConfidence ?? 0.6;

  const reached = callStatus === 'completed' && payerTurns.length > 0;
  required(checks, 'payer response present', reached,
    reached ? `${payerTurns.length} payer-side transcript turns` : `status ${callStatus || 'missing'} with no payer response`);
  if (!reached) return result('unreachable', checks, 'No payer response exists to verify.');

  const expectedReference = canonicalReference(input.expectedClaimReference);
  const outcomeReference = canonicalReference(input.outcome.claimReference);
  const referenceBound = Boolean(expectedReference) && outcomeReference === expectedReference && referenceInClaimContext(payerText, expectedReference);
  required(checks, 'claim reference bound', referenceBound,
    referenceBound ? `payer repeated claim ${maskedReference(expectedReference)}` : 'the returned result is not bound to the requested claim');

  const questionGrounded = quoteInTurns(input.outcome.evidence.question, agentTurns.map((turn) => turn.text));
  const questionContainsReference = Boolean(expectedReference) && referenceInClaimContext(agentText, expectedReference);
  const questionHasIntent = /\b(status|paid|payment|denied|denial|processed|claim)\b/i.test(input.outcome.evidence.question);
  required(checks, 'question was actually asked', questionGrounded && questionContainsReference && questionHasIntent,
    questionGrounded && questionContainsReference && questionHasIntent
      ? 'the agent transcript contains the claim-specific question'
      : 'the result claims an answer but the transcript does not contain the required question');

  const destinationGrounded = quoteInTurns(input.outcome.evidence.destination, payerTurns.map((turn) => turn.text));
  const departmentNeedle = normalise(input.expectedDepartment ?? input.outcome.department);
  const destinationMatches = destinationGrounded && contentWords(departmentNeedle).every((word) => normalise(input.outcome.evidence.destination).includes(word));
  required(checks, 'claims department established', destinationMatches,
    destinationMatches ? `payer identified ${input.outcome.department}` : 'no grounded payer statement establishes the intended department');

  const answerGrounded = quoteInTurns(input.outcome.evidence.answer, payerTurns.map((turn) => turn.text));
  required(checks, 'answer quote grounded', answerGrounded,
    answerGrounded ? 'the exact evidence quote appears on the payer side' : 'the supplied answer evidence is absent from the payer transcript');

  const statusSupported = STATUS_WORDS[input.outcome.status].some((phrase) => normalise(input.outcome.evidence.answer).includes(normalise(phrase)));
  required(checks, 'claim status supported', statusSupported,
    statusSupported ? `payer evidence supports ${input.outcome.status}` : `payer evidence does not support ${input.outcome.status}`);

  if (input.outcome.paidAmount) {
    const amount = canonicalNumber(input.outcome.paidAmount);
    const amountSupported = Boolean(amount) && numbersIn(input.outcome.evidence.answer).has(amount);
    required(checks, 'paid amount supported', amountSupported,
      amountSupported ? `amount ${input.outcome.paidAmount} occurs in the answer quote` : `amount ${input.outcome.paidAmount} is not in the answer quote`);
  }

  if (input.outcome.paymentDate) {
    const dateSupported = supportsDate(input.outcome.paymentDate, input.outcome.evidence.answer);
    required(checks, 'payment date supported', dateSupported,
      dateSupported ? `date ${input.outcome.paymentDate} is grounded` : `date ${input.outcome.paymentDate} is not grounded`);
  }

  if (input.outcome.denialCode) {
    const denialSupported = normalise(input.outcome.evidence.answer).includes(normalise(input.outcome.denialCode));
    required(checks, 'denial code supported', denialSupported,
      denialSupported ? `denial code ${input.outcome.denialCode} is grounded` : `denial code ${input.outcome.denialCode} is not grounded`);
  }

  if (input.outcome.nextAction) {
    const actionWords = contentWords(input.outcome.nextAction);
    const answerText = normalise(input.outcome.evidence.answer);
    const actionSupported = actionWords.length > 0 && actionWords.every((word) => answerText.includes(word));
    corroborating(checks, 'next action provenance', actionSupported,
      actionSupported ? 'the payer evidence contains the suggested action' : 'operator-policy recommendation; not represented as payer testimony');
  }

  const routePresent = Boolean(input.routeReceipt);
  required(checks, 'independent route receipt', routePresent,
    routePresent ? `received from ${input.routeReceipt!.source}` : 'no fixture log, decoded DTMF audio, or provider event was supplied');
  if (input.routeReceipt) {
    const routeMatches = arraysEqual(input.reportedKeys, input.routeReceipt.keys);
    required(checks, 'keypress trail matches', routeMatches,
      routeMatches ? `independent trail ${input.routeReceipt.keys.join(' → ') || '(none)'}` : `reported ${input.reportedKeys.join(' → ')} but receipt shows ${input.routeReceipt.keys.join(' → ')}`);
  }

  const confidenceOk = confidence === undefined || confidence >= minConfidence;
  corroborating(checks, 'CALL-E confidence', confidenceOk,
    confidence === undefined ? 'provider confidence unavailable' : `${confidence.toFixed(2)} against ${minConfidence.toFixed(2)} floor`);

  // CALL-E attaches its own justifications to a result. They are the model explaining itself,
  // so they get the same treatment as the structured fields: anything they assert about
  // status or money must have been said by the payer. A provider that reports "the
  // representative confirmed payment of $1,500" when nobody said 1,500 has told us it is
  // narrating, and a narrated result is not auto-accepted.
  const unsupportedEvidence = unsupportedProviderClaims(input.call.evidence ?? [], payerText);
  const providerEvidenceOk = unsupportedEvidence.length === 0;
  corroborating(checks, 'provider evidence cross-examined', providerEvidenceOk,
    (input.call.evidence ?? []).length === 0
      ? 'no provider evidence attached'
      : providerEvidenceOk
        ? `${input.call.evidence!.length} provider justification(s) are consistent with payer speech`
        : `provider evidence asserts ${unsupportedEvidence.join(', ')} which the payer never said`);

  const failed = checks.filter((check) => check.severity === 'required' && !check.passed);
  if (failed.length === 0 && confidenceOk && providerEvidenceOk) {
    return result('verified', checks, 'Transcript, destination, claim fields, and independent route receipt agree.');
  }
  const contradictionNames = new Set(['claim reference bound', 'claims department established', 'claim status supported', 'paid amount supported', 'payment date supported', 'denial code supported', 'keypress trail matches']);
  const contradicted = failed.some((check) => contradictionNames.has(check.name));
  return result(
    contradicted ? 'contradicted' : 'needs_review',
    checks,
    contradicted
      ? 'At least one witness conflicts with the structured result. Do not write it to the claim record.'
      : 'Evidence is incomplete. A biller must review the call before using the result.',
  );
}

/**
 * Facts a provider justification asserts that the payer transcript does not contain: a claim
 * status word, or any number of three or more digits (an amount, a year, a reference).
 */
function unsupportedProviderClaims(evidence: string[], payerText: string): string[] {
  const payer = normalise(payerText);
  const payerNumbers = numbersIn(payerText);
  const missing: string[] = [];
  for (const item of evidence) {
    const text = normalise(item);
    for (const [status, phrases] of Object.entries(STATUS_WORDS)) {
      if (status === 'unknown') continue;
      const asserted = phrases.find((phrase) => text.includes(normalise(phrase)));
      if (asserted && !phrases.some((phrase) => payer.includes(normalise(phrase)))) missing.push(`"${asserted}"`);
    }
    for (const number of numbersIn(item)) {
      if (number.replace(/\D/g, '').length >= 3 && !payerNumbers.has(number)) missing.push(number);
    }
  }
  return [...new Set(missing)];
}

function result(verdict: ClaimVerification['verdict'], checks: WitnessCheck[], summary: string): ClaimVerification {
  return { verdict, checks, autoAccept: verdict === 'verified', summary };
}

function required(checks: WitnessCheck[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, severity: 'required', detail });
}

function corroborating(checks: WitnessCheck[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, severity: 'corroborating', detail });
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentWords(value: string): string[] {
  const ignored = new Set(['the', 'a', 'an', 'of', 'for']);
  return normalise(value).split(' ').filter((word) => word.length > 2 && !ignored.has(word));
}

function quoteInTurns(quote: string, turns: string[]): boolean {
  const needle = normalise(quote);
  return needle.length >= 4 && turns.some((turn) => normalise(turn).includes(needle));
}

function canonicalNumber(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? String(number) : '';
}

function canonicalReference(value: string): string {
  return value.replace(/\D/g, '');
}

/** Keep leading zeroes and only accept a number near "claim" or "reference". */
function referenceInClaimContext(text: string, expected: string): boolean {
  const windows = text.match(/\b(?:claim|reference)\b[^.!?\n]{0,80}/gi) ?? [];
  return windows.some((window) => {
    const digitRuns = window.match(/\d(?:[\d\s-]*\d)?/g) ?? [];
    if (digitRuns.some((run) => run.replace(/\D/g, '') === expected)) return true;
    return !expected.startsWith('0') && numbersIn(window).has(String(Number(expected)));
  });
}

function maskedReference(value: string): string {
  if (value.length <= 4) return value;
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function supportsDate(isoDate: string, evidence: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return normalise(evidence).includes(normalise(isoDate));
  const monthIndex = Number(match[2]) - 1;
  const day = String(Number(match[3]));
  const month = MONTHS[monthIndex];
  return month !== undefined
    && normalise(evidence).includes(month)
    && numbersIn(evidence).has(day)
    && numbersIn(evidence).has(match[1]!);
}
