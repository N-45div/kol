import { createHash, timingSafeEqual } from 'node:crypto';

const API_ORIGIN = 'https://api.heycall-e.com';
const TERMINAL = new Set(['completed', 'failed', 'no_answer', 'declined', 'canceled', 'cancelled', 'voicemail', 'busy', 'expired']);

type CallRecord = {
  id?: string;
  call_id?: string;
  status?: string;
  failure_code?: string | null;
  structured_result?: Record<string, unknown> | null;
  recipients?: Array<{ status?: string; structured_result?: Record<string, unknown> | null; attempts?: Array<{ transcript_turns?: unknown[] }> }>;
};

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

export async function createSmokeCall(to: string): Promise<CallRecord> {
  const task = [
    'Place one brief authorised product smoke-test call.',
    'Begin by saying: Hello, this is an automated test call from Kol. This call contains no medical information.',
    'Ask the recipient to say exactly: Kol test received.',
    'Record whether the exact phrase was heard, thank the recipient, and end the call.',
    'Do not ask for a name, identity, health information, payment, or any other personal data.',
  ].join(' ');
  const request = {
    task,
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
  const hour = new Date().toISOString().slice(0, 13);
  const idempotencyKey = `kol-web-${createHash('sha256').update(`${JSON.stringify(request)}:${hour}`).digest('hex').slice(0, 32)}`;
  return calle('/v1/calls', { method: 'POST', body: JSON.stringify(request), headers: { 'Idempotency-Key': idempotencyKey } });
}

export async function getCall(callId: string): Promise<CallRecord> {
  if (!/^call_[A-Za-z0-9_-]{8,}$/.test(callId)) throw new Error('Invalid call id.');
  return calle(`/v1/calls/${encodeURIComponent(callId)}`);
}

export function publicCallState(call: CallRecord) {
  const recipient = call.recipients?.[0];
  const result = call.structured_result ?? recipient?.structured_result ?? {};
  const status = String(call.status ?? recipient?.status ?? 'unknown').toLowerCase();
  const transcriptTurns = (call.recipients ?? []).flatMap((item) => item.attempts ?? []).reduce((count, attempt) => count + (attempt.transcript_turns?.length ?? 0), 0);
  return {
    callId: String(call.id ?? call.call_id ?? ''),
    status,
    terminal: TERMINAL.has(status),
    phraseHeard: result.test_phrase_heard === true,
    transcriptTurns,
    failureCode: call.failure_code ? String(call.failure_code) : null,
  };
}

async function calle(path: string, init: RequestInit = {}): Promise<CallRecord> {
  const apiKey = process.env.CALLE_API_KEY ?? '';
  if (!apiKey) throw new Error('CALL-E is not configured.');
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`CALL-E returned HTTP ${response.status}. Check the dashboard before retrying.`);
  return response.json() as Promise<CallRecord>;
}
