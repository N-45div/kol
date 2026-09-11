export type DemoScenario = 'reachability' | 'claim_evidence';
export type LiveVerdict = 'processing' | 'verified' | 'needs_review' | 'contradicted' | 'unreachable';

export const CLAIM_DEMO = {
  reference: '4471',
  department: 'Claims status department',
  status: 'paid',
  amount: '$1,240',
  paymentDate: 'August 12, 2026',
} as const;

export interface ProviderTranscriptTurn {
  offset_seconds?: number;
  speaker?: string;
  text?: string;
}

export interface ProviderCall {
  id?: string;
  call_id?: string;
  status?: string;
  failure_code?: string | null;
  metadata?: Record<string, unknown> | null;
  structured_result?: Record<string, unknown> | null;
  recipients?: Array<{
    status?: string;
    structured_result?: Record<string, unknown> | null;
    attempts?: Array<{ transcript_turns?: ProviderTranscriptTurn[] }>;
  }>;
}

export interface EvidenceCheck {
  label: string;
  passed: boolean;
  required: boolean;
  detail: string;
}

export interface PublicCallState {
  callId: string;
  status: string;
  terminal: boolean;
  scenario: DemoScenario;
  phraseHeard: boolean;
  transcriptTurns: number;
  transcript: Array<{ offsetSeconds: number; speaker: 'Kol' | 'Recipient'; text: string }>;
  verdict: LiveVerdict;
  summary: string;
  checks: EvidenceCheck[];
  extracted?: {
    claimReference: string;
    status: string;
    amount: string;
    paymentDate: string;
    department: string;
  };
  failureCode?: string | null;
}

const TERMINAL = new Set(['completed', 'failed', 'no_answer', 'declined', 'canceled', 'cancelled', 'voicemail', 'busy', 'expired']);
const TEST_PHRASE = 'kol test received';

export function buildPublicCallState(call: ProviderCall): PublicCallState {
  const recipient = call.recipients?.[0];
  const result = call.structured_result ?? recipient?.structured_result ?? {};
  const status = String(call.status ?? recipient?.status ?? 'unknown').toLowerCase();
  const scenario: DemoScenario = call.metadata?.kol_scenario === 'fictional-claim-evidence-demo' ? 'claim_evidence' : 'reachability';
  const transcript = (call.recipients ?? [])
    .flatMap((item) => item.attempts ?? [])
    .flatMap((attempt) => attempt.transcript_turns ?? [])
    .map((turn) => ({
      offsetSeconds: Number(turn.offset_seconds ?? 0),
      speaker: turn.speaker === 'bot' ? 'Kol' as const : 'Recipient' as const,
      text: maskSensitive(String(turn.text ?? '').trim()),
    }))
    .filter((turn) => turn.text)
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const terminal = TERMINAL.has(status);
  const phraseInTranscript = transcript.some((turn) => turn.speaker === 'Recipient' && normalise(turn.text).includes(TEST_PHRASE));
  const phraseHeard = phraseInTranscript;

  const common = {
    callId: String(call.id ?? call.call_id ?? ''),
    status,
    terminal,
    scenario,
    phraseHeard,
    transcriptTurns: transcript.length,
    transcript,
    failureCode: call.failure_code ? String(call.failure_code) : null,
  };

  if (!terminal) return { ...common, verdict: 'processing', summary: 'CALL-E is still working.', checks: [] };
  if (status !== 'completed') {
    return { ...common, verdict: 'unreachable', summary: 'The destination did not produce a completed conversation.', checks: [check('Call completed', false, 'No answer exists to verify.')] };
  }
  return scenario === 'claim_evidence'
    ? { ...common, ...evaluateClaim(transcript, result) }
    : { ...common, ...evaluateReachability(phraseHeard, phraseInTranscript, result) };
}

function evaluateReachability(phraseHeard: boolean, grounded: boolean, result: Record<string, unknown>) {
  const checks = [
    check('Call completed', true, 'CALL-E completed the authorised call.'),
    check('Phrase witness', phraseHeard, grounded
      ? 'The exact phrase appears in recipient-side transcript evidence.'
      : booleanValue(result.test_phrase_heard)
        ? 'CALL-E reported the phrase, but the exact transcript span was unavailable.'
        : 'The exact phrase was not found in recipient-side transcript evidence.'),
  ];
  return {
    verdict: phraseHeard ? 'verified' as const : 'needs_review' as const,
    summary: phraseHeard ? 'Reachability and the exact recipient phrase are supported.' : 'The call completed, but the requested phrase is unsupported.',
    checks,
  };
}

function evaluateClaim(transcript: PublicCallState['transcript'], result: Record<string, unknown>) {
  const agentText = transcript.filter((turn) => turn.speaker === 'Kol').map((turn) => turn.text).join(' ');
  const payerText = transcript.filter((turn) => turn.speaker === 'Recipient').map((turn) => turn.text).join(' ');
  const extracted = {
    claimReference: String(result.claim_reference ?? ''),
    status: String(result.claim_status ?? ''),
    amount: String(result.paid_amount ?? ''),
    paymentDate: String(result.payment_date ?? ''),
    department: String(result.target_name_used ?? ''),
  };
  const checks = [
    check('Call completed', true, 'CALL-E completed the authorised mock-payer call.'),
    check('Question witness', supportsQuestion(agentText), 'The agent transcript must contain the claim-specific question.'),
    check('Destination witness', supportsDepartment(payerText) && supportsDepartment(extracted.department), 'Both extraction and recipient-side words must establish the claims status department.'),
    check('Claim reference', supportsReference(payerText) && digits(extracted.claimReference) === CLAIM_DEMO.reference, 'Both extraction and recipient transcript must identify fictional claim 4471.'),
    check('Status witness', normalise(payerText).includes('paid') && normalise(extracted.status) === 'paid', 'Both extraction and recipient transcript must support paid status.'),
    check('Amount witness', supportsAmount(payerText) && supportsAmount(extracted.amount), 'Both extraction and recipient transcript must support $1,240.'),
    check('Date witness', supportsDate(payerText) && supportsDate(extracted.paymentDate), 'Both extraction and recipient transcript must support August 12, 2026.'),
    check('Independent route receipt', false, 'A direct phone role-play has no independent IVR keypress witness.'),
  ];
  const fieldChecksPass = checks.slice(0, -1).every((item) => item.passed);
  return {
    verdict: fieldChecksPass ? 'needs_review' as const : 'contradicted' as const,
    summary: fieldChecksPass
      ? 'The live claim fields are grounded, but no independent IVR route receipt exists. Human review is required.'
      : 'At least one live claim field conflicts with or is absent from the transcript. Do not use this result.',
    checks,
    extracted,
  };
}

function check(label: string, passed: boolean, detail: string): EvidenceCheck {
  return { label, passed, required: true, detail };
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s$]/g, ' ').replace(/\s+/g, ' ').trim();
}

function booleanValue(value: unknown) {
  return value === true || ['true', 'yes'].includes(normalise(String(value ?? '')));
}

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function canonicalAmount(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? String(parsed) : '';
}

function supportsQuestion(value: string) {
  const text = normalise(value);
  return text.includes('claim') && (text.includes('status') || text.includes('paid')) && supportsReference(text);
}

function supportsDepartment(value: string) {
  const text = normalise(value);
  return text.includes('claims') && text.includes('status') && text.includes('department');
}

function supportsReference(value: string) {
  const text = normalise(value);
  return /\b4471\b/.test(text) || /\b4\s+4\s+7\s+1\b/.test(text) || text.includes('four four seven one');
}

function supportsAmount(value: string) {
  const text = normalise(value);
  const numericMatch = [...value.matchAll(/(?:\$\s*)?\d[\d,]*(?:\.\d+)?/g)]
    .some((match) => canonicalAmount(match[0]) === '1240');
  return numericMatch || text.includes('one thousand two hundred forty');
}

function supportsDate(value: string) {
  const text = normalise(value);
  if (/\b2026[\s-]+0?8[\s-]+12\b/.test(value.toLowerCase())) return true;
  const hasMonthDay = text.includes('august 12') || text.includes('august twelfth');
  const hasYear = text.includes('2026') || text.includes('twenty twenty six') || text.includes('two thousand twenty six');
  return hasMonthDay && hasYear;
}

function maskSensitive(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email masked]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, (match) => {
      const number = match.replace(/\D/g, '');
      return number.length > 4 ? `••••${number.slice(-4)}` : '••••';
    });
}
