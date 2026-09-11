import { createHash, timingSafeEqual } from 'node:crypto';
import {
  buildPublicCallState,
  CLAIM_DEMO,
  type DemoScenario,
  type ProviderCall,
  type PublicCallState,
} from './live-evidence';

const API_ORIGIN = 'https://api.heycall-e.com';

export function callingEnabled() {
  return process.env.KOL_CALLING_ENABLED === 'true' && Boolean(process.env.CALLE_API_KEY && process.env.KOL_DEMO_PIN);
}

export function verifyPin(candidate: string) {
  const expected = process.env.KOL_DEMO_PIN ?? '';
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function validateDestination(value: string) {
  const normalised = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(normalised)) throw new Error('Enter a valid E.164 number, including country code.');
  const allowed = (process.env.KOL_ALLOWED_DESTINATIONS ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!allowed.includes(normalised)) throw new Error('That destination is not on this deployment\'s test allowlist.');
  return normalised;
}

export async function createDemoCall(to: string, scenario: DemoScenario): Promise<ProviderCall> {
  const request = scenario === 'claim_evidence' ? claimDemoRequest(to) : reachabilityRequest(to);
  const hour = new Date().toISOString().slice(0, 13);
  const idempotencyKey = `kol-web-${createHash('sha256').update(`${JSON.stringify(request)}:${hour}`).digest('hex').slice(0, 32)}`;
  return calle('/v1/calls', { method: 'POST', body: JSON.stringify(request), headers: { 'Idempotency-Key': idempotencyKey } });
}

function reachabilityRequest(to: string) {
  return {
    task: [
      'Place one brief authorised product smoke-test call.',
      'Begin by saying: Hello, this is an automated test call from Kol. This call contains no medical information.',
      'Ask the recipient to say exactly: Kol test received.',
      'Record whether the exact phrase was heard, thank the recipient, and end the call.',
      'Do not ask for a name, identity, health information, payment, or any other personal data.',
    ].join(' '),
    recipients: [{ phones: [to], region: to.startsWith('+91') ? 'IN' : 'US', locale: to.startsWith('+91') ? 'en-IN' : 'en-US' }],
    result_schema: {
      type: 'object',
      required: ['test_phrase_heard', 'exact_phrase'],
      properties: {
        test_phrase_heard: { type: 'boolean' },
        exact_phrase: { type: 'string', description: 'Exact recipient words, or an empty string.' },
      },
    },
    metadata: { kol_scenario: 'authorised-product-smoke-test', purpose: 'no-phi-reachability-test' },
  };
}

function claimDemoRequest(to: string) {
  return {
    task: [
      'Place one authorised healthcare evidence demonstration call to a participant who will role-play a payer representative using fictional data.',
      'Begin by saying: Hello, this is Kol, an automated assistant running a fictional claim-status demonstration. No real medical data is involved.',
      `Ask: Are you speaking for the ${CLAIM_DEMO.department}?`,
      `Then ask exactly: What is the current status of fictional claim ${CLAIM_DEMO.reference}?`,
      'Do not suggest the answer. Listen for the recipient response, repeat it once for confirmation, thank them, and end the call.',
      'Do not ask for a name, member ID, date of birth, health information, payment, or any other personal data.',
    ].join(' '),
    recipients: [{ phones: [to], region: to.startsWith('+91') ? 'IN' : 'US', locale: to.startsWith('+91') ? 'en-IN' : 'en-US' }],
    result_schema: {
      type: 'object',
      required: ['target_name_used', 'claim_reference', 'claim_status', 'paid_amount', 'payment_date', 'department_evidence', 'question_evidence', 'answer_evidence'],
      properties: {
        target_name_used: { type: 'string' },
        claim_reference: { type: 'string' },
        claim_status: { type: 'string', enum: ['paid', 'pending', 'denied', 'unknown'] },
        paid_amount: { type: 'string' },
        payment_date: { type: 'string' },
        department_evidence: { type: 'string', description: 'Exact recipient words establishing the department, or empty.' },
        question_evidence: { type: 'string', description: 'Exact assistant words containing the question, or empty.' },
        answer_evidence: { type: 'string', description: 'Exact recipient words supporting the claim outcome, or empty.' },
      },
    },
    metadata: { kol_scenario: 'fictional-claim-evidence-demo', purpose: 'no-phi-field-grounding-test' },
  };
}

export async function getCall(callId: string): Promise<ProviderCall> {
  if (!/^call_[A-Za-z0-9_-]{8,}$/.test(callId)) throw new Error('Invalid call id.');
  return calle(`/v1/calls/${encodeURIComponent(callId)}`);
}

export function publicCallState(call: ProviderCall): PublicCallState {
  return buildPublicCallState(call);
}

async function calle(path: string, init: RequestInit = {}): Promise<ProviderCall> {
  const apiKey = process.env.CALLE_API_KEY ?? '';
  if (!apiKey) throw new Error('CALL-E is not configured.');
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`CALL-E returned HTTP ${response.status}. Check the dashboard before retrying.`);
  return response.json() as Promise<ProviderCall>;
}
