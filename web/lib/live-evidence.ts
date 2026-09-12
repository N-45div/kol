export type DemoScenario = 'reachability' | 'claim_evidence' | 'ivr_route';
export type LiveVerdict = 'processing' | 'verified' | 'needs_review' | 'contradicted' | 'unreachable';

export const CLAIM_DEMO = {
  reference: '4471',
  department: 'Claims status department',
  status: 'paid',
  amount: '$1,240',
  paymentDate: 'August 12, 2026',
} as const;

/**
 * The fictional two-level phone tree the recipient reads aloud in the IVR route scenario.
 * The keys are the Route Atlas entry for (Fixture Health Plan, claim_status); the task text
 * dictates them up front, which is what a replay is.
 */
export const ROUTE_DEMO = {
  org: 'Fixture Health Plan',
  keys: ['2', '1'],
  menus: [
    'Thank you for calling Fixture Health Plan. For member eligibility, press 1. For claims, press 2. For provider services, press 3.',
    'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.',
  ],
} as const;

/** Who says which keys were pressed. The model reporting its own keys is never a receipt. */
export interface RouteReceipt {
  source: 'operator';
  keys: string[];
  note: string;
}

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
  /** Keys the model says it pressed, in order. Present only for the IVR route scenario. */
  reportedRoute?: string[];
  /** An independent account of the keys, when one has been supplied. */
  routeReceipt?: RouteReceipt | null;
  failureCode?: string | null;
}

const TERMINAL = new Set(['completed', 'failed', 'no_answer', 'declined', 'canceled', 'cancelled', 'voicemail', 'busy', 'expired']);
const TEST_PHRASE = 'kol test received';

export function buildPublicCallState(call: ProviderCall): PublicCallState {
  const recipient = call.recipients?.[0];
  const result = call.structured_result ?? recipient?.structured_result ?? {};
  const status = String(call.status ?? recipient?.status ?? 'unknown').toLowerCase();
  const scenario: DemoScenario = call.metadata?.kol_scenario === 'fictional-claim-evidence-demo'
    ? 'claim_evidence'
    : call.metadata?.kol_scenario === 'fictional-ivr-route-demo'
      ? 'ivr_route'
      : 'reachability';
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
  if (scenario === 'ivr_route') return { ...common, ...evaluateRoute(transcript, reportedKeys(result), result, null) };
  return scenario === 'claim_evidence'
    ? { ...common, ...evaluateClaim(transcript, result) }
    : { ...common, ...evaluateReachability(phraseHeard, phraseInTranscript, result) };
}

/**
 * Attach an operator-attested route receipt to a finished IVR-route call and re-run the gate.
 * Pure: the original state is not modified. The keys are what the person who answered heard
 * CALL-E press, so they are independent of the model, though weaker than a fixture log or
 * decoded audio, and the check says so.
 */
export function applyRouteReceipt(state: PublicCallState, heardKeys: string): PublicCallState {
  if (state.scenario !== 'ivr_route' || !state.terminal || state.status !== 'completed') return state;
  const receipt: RouteReceipt = {
    source: 'operator',
    keys: heardKeys.replace(/[^0-9*#]/g, '').split('').filter(Boolean),
    note: 'Keys heard on the phone and entered by the person who answered. Independent of the model; weaker than a fixture log or decoded audio.',
  };
  const gate = evaluateRoute(state.transcript, state.reportedRoute ?? [], extractedAsResult(state), receipt);
  return { ...state, ...gate, routeReceipt: receipt };
}

function extractedAsResult(state: PublicCallState): Record<string, unknown> {
  return {
    claim_reference: state.extracted?.claimReference ?? '',
    claim_status: state.extracted?.status ?? '',
    paid_amount: state.extracted?.amount ?? '',
    payment_date: state.extracted?.paymentDate ?? '',
    target_name_used: state.extracted?.department ?? '',
  };
}

/** Keys the model says it pressed, in menu order, ignoring anything that is not a keypress. */
function reportedKeys(result: Record<string, unknown>): string[] {
  const levels = Array.isArray(result.menu_levels) ? result.menu_levels as Array<Record<string, unknown>> : [];
  return levels
    .filter((level) => level && typeof level === 'object')
    .sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0))
    .filter((level) => String(level.action_type ?? '').toLowerCase() === 'dtmf')
    .map((level) => String(level.action_value ?? '').replace(/[^0-9*#]/g, ''))
    .filter(Boolean);
}

function evaluateRoute(
  transcript: PublicCallState['transcript'],
  reported: string[],
  result: Record<string, unknown>,
  receipt: RouteReceipt | null,
) {
  const agentText = transcript.filter((turn) => turn.speaker === 'Kol').map((turn) => turn.text).join(' ');
  const payerText = transcript.filter((turn) => turn.speaker === 'Recipient').map((turn) => turn.text).join(' ');
  const expected = [...ROUTE_DEMO.keys];
  const reportedMatchesPlan = reported.join(',') === expected.join(',');
  const menusHeard = normalise(payerText).includes('for claims press 2') && normalise(payerText).includes('existing claim press 1');
  const receiptAgrees = receipt ? receipt.keys.join(',') === reported.join(',') : false;
  const extracted = {
    claimReference: String(result.claim_reference ?? ''),
    status: String(result.claim_status ?? ''),
    amount: String(result.paid_amount ?? ''),
    paymentDate: String(result.payment_date ?? ''),
    department: String(result.target_name_used ?? ''),
  };
  const said = (keys: string[]) => keys.join(' then ') || 'nothing';

  const checks = [
    check('Call completed', true, 'CALL-E completed the authorised mock-IVR call.'),
    check('Route reported', reported.length > 0, reported.length > 0
      ? `CALL-E reports pressing ${said(reported)}. This is the model reporting on itself, not evidence.`
      : 'CALL-E reported no keypresses at all. It may have spoken to the menu instead of pressing keys.'),
    check('Replay followed the atlas', reportedMatchesPlan, reportedMatchesPlan
      ? `The reported keys match the compiled route ${said(expected)}.`
      : `The route asked for ${said(expected)}; the model reports ${said(reported)}.`),
    check('Menu witness', menusHeard, menusHeard
      ? 'Both menu prompts appear on the recipient side of the transcript, so the tree was really read out.'
      : 'The recipient-side transcript does not contain both menu prompts.'),
    check('Question witness', supportsQuestion(agentText), 'The agent transcript must contain the claim-specific question after the menus.'),
    check('Independent route receipt', receiptAgrees, receipt
      ? receiptAgrees
        ? `The operator heard ${said(receipt.keys)}, which matches the reported route. ${receipt.note}`
        : `The operator heard ${said(receipt.keys)}, but the model reports ${said(reported)}. The route is contradicted and would be quarantined.`
      : 'No independent account of the keypresses exists yet. Enter the keys you heard to supply an operator-attested receipt.'),
  ];

  const modelSide = checks.slice(0, 5).every((item) => item.passed);
  const verdict = !modelSide || (receipt && !receiptAgrees)
    ? 'contradicted' as const
    : receipt
      ? 'verified' as const
      : 'needs_review' as const;
  const summary = verdict === 'verified'
    ? 'The compiled route was replayed, the menus were really heard, the question was asked, and an independent account of the keys agrees. This route may teach the atlas.'
    : verdict === 'needs_review'
      ? 'The model-side witnesses agree, but the model is the only witness to its own keypresses. Supply the keys you heard, or the result stays under review.'
      : 'A witness disagrees with the reported route. Nothing is written, and the cached route would be quarantined.';
  return { verdict, summary, checks, extracted, reportedRoute: reported, routeReceipt: receipt };
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
