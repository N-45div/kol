import { calleeTurns, type CallRecord, type TranscriptTurn } from '../calle/types.ts';
import { unsupportedNumbers } from './numbers.ts';

/**
 * Does the answer match what was actually said?
 *
 * Every phone agent in this space — CALL-E's own navigator included — reports a structured
 * result and is believed. But the result is written by a model that was listening to a noisy
 * phone line, and the failure that matters is not a dropped call. It is a confident, plausible
 * answer that the callee never gave: the right shape, the wrong number, delivered by an agent
 * that also believes it reached the claims department when it reached provider services.
 *
 * So nothing here trusts the structured result on its own. Four independent checks, each of
 * which can only ever *reduce* confidence:
 *
 *   1. Did the call reach a human at all, or is this a voicemail dressed as an answer?
 *   2. Is every number in the answer present in what the callee said?
 *   3. If the line publishes a leaf marker, did we hear it — proof of *where* we landed?
 *   4. Is the provider's own completion confidence above the floor?
 *
 * A verdict is never better than the weakest check.
 */

export type Verdict = 'verified' | 'unsupported' | 'contradicted' | 'unreachable';

export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationInput {
  call: CallRecord;
  /** The answer the call claims to have obtained. */
  answer: string;
  /**
   * A phrase only spoken at the intended destination — the fixture's leaf passphrase, an
   * agent's stated department, a reference read back. Optional; when present it is the
   * strongest available evidence of where the call actually landed.
   */
  expectedLeafMarker?: string;
  /** Below this, the provider itself is unsure. Default 0.6. */
  minConfidence?: number;
}

export interface Verification {
  verdict: Verdict;
  checks: CheckResult[];
  /** The callee turn that best supports the answer, for display next to it. */
  supportingSpan?: TranscriptTurn;
  /** Numbers asserted in the answer that nobody said. The most actionable failure. */
  unsupportedNumbers: string[];
  confidence?: number;
  summary: string;
}

const TERMINAL_NOT_ANSWERED = new Set(['no_answer', 'voicemail', 'busy', 'declined', 'failed', 'canceled', 'cancelled', 'expired']);

export function verifyAnswer(input: VerificationInput): Verification {
  const { call, answer } = input;
  const minConfidence = input.minConfidence ?? 0.6;
  const checks: CheckResult[] = [];

  const turns = calleeTurns(call);
  const calleeText = turns.map((t) => t.text).join(' ');
  const status = String(call.status ?? '').toLowerCase();
  const confidence = call.completion_confidence?.score;

  // 1. Reached a human.
  const reached = status === 'completed' && turns.length > 0;
  checks.push({
    name: 'reached a human',
    passed: reached,
    detail: reached
      ? `status ${status}, ${turns.length} turns from the other side`
      : `status ${status}, ${turns.length} callee turns — nobody spoke to us`,
  });

  if (!reached) {
    return {
      verdict: 'unreachable',
      checks,
      unsupportedNumbers: [],
      ...(confidence !== undefined ? { confidence } : {}),
      summary: TERMINAL_NOT_ANSWERED.has(status)
        ? `The call ended as ${status}. There is no answer to verify.`
        : 'No one spoke on the other end. There is no answer to verify.',
    };
  }

  // 2. Every number in the answer was said.
  const missing = answer.trim() ? unsupportedNumbers(answer, calleeText) : [];
  checks.push({
    name: 'numbers were spoken',
    passed: missing.length === 0,
    detail: missing.length === 0
      ? 'every number in the answer appears in the transcript'
      : `not said by the callee: ${missing.join(', ')}`,
  });

  // 3. Landed where we intended.
  const marker = input.expectedLeafMarker?.trim();
  let markerHeard: boolean | undefined;
  if (marker) {
    markerHeard = normalise(calleeText).includes(normalise(marker));
    checks.push({
      name: 'reached the intended destination',
      passed: markerHeard,
      detail: markerHeard
        ? `heard the expected marker "${marker}"`
        : `never heard "${marker}" — the call may have landed somewhere else`,
    });
  }

  // 4. The provider's own confidence.
  const confidenceOk = confidence === undefined || confidence >= minConfidence;
  checks.push({
    name: 'provider confidence',
    passed: confidenceOk,
    detail: confidence === undefined
      ? 'no confidence reported'
      : `${confidence.toFixed(2)} against a floor of ${minConfidence.toFixed(2)}`,
  });

  const supportingSpan = bestSupportingTurn(turns, answer);

  // A missing leaf marker means we probably answered from the wrong place: contradicted, not
  // merely unsupported. Unsaid numbers are the same class of problem — the answer asserts
  // something the recording does not contain.
  let verdict: Verdict = 'verified';
  if (markerHeard === false || missing.length > 0) {
    verdict = 'contradicted';
  } else if (!confidenceOk || !supportingSpan) {
    verdict = 'unsupported';
  }

  return {
    verdict,
    checks,
    ...(supportingSpan ? { supportingSpan } : {}),
    unsupportedNumbers: missing,
    ...(confidence !== undefined ? { confidence } : {}),
    summary: summarise(verdict, missing, marker, markerHeard, confidence, minConfidence),
  };
}

function summarise(
  verdict: Verdict,
  missing: string[],
  marker: string | undefined,
  markerHeard: boolean | undefined,
  confidence: number | undefined,
  minConfidence: number,
): string {
  if (verdict === 'verified') return 'The answer is supported by the words the callee spoke.';
  if (verdict === 'contradicted') {
    if (missing.length > 0) {
      return `The answer contains ${missing.length === 1 ? 'a number' : 'numbers'} nobody said: ${missing.join(', ')}. Treat it as unreliable.`;
    }
    return `The call never heard "${marker}", so it probably did not reach the intended destination. Treat the answer as unreliable.`;
  }
  if (confidence !== undefined && confidence < minConfidence) {
    return `The provider reported low confidence (${confidence.toFixed(2)} < ${minConfidence.toFixed(2)}). A person should read the transcript.`;
  }
  return 'Nothing the callee said clearly supports this answer. A person should read the transcript.';
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'was', 'is', 'are', 'were', 'on', 'in', 'at', 'of', 'for', 'to', 'and',
  'your', 'you', 'it', 'that', 'this', 'be', 'been', 'has', 'have', 'had', 'as', 'by', 'with',
]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentTokens(text: string): string[] {
  return normalise(text).split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * The callee turn sharing the most content with the answer. Displayed beside the answer so an
 * operator can see the sentence it came from rather than taking the summary on faith.
 */
export function bestSupportingTurn(turns: TranscriptTurn[], answer: string): TranscriptTurn | undefined {
  const wanted = new Set(contentTokens(answer));
  if (wanted.size === 0) return turns[0];

  let best: TranscriptTurn | undefined;
  let bestScore = 0;
  for (const turn of turns) {
    const tokens = new Set(contentTokens(turn.text));
    let shared = 0;
    for (const token of tokens) if (wanted.has(token)) shared++;
    const score = shared / wanted.size;
    if (score > bestScore) {
      bestScore = score;
      best = turn;
    }
  }
  // Below a third of the answer's content words, the "support" is coincidence.
  return bestScore >= 0.34 ? best : undefined;
}
