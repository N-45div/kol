import { createHash, timingSafeEqual } from 'node:crypto';
import {
  buildPublicCallState,
  CLAIM_DEMO,
  ROUTE_DEMO,
  type DemoScenario,
  type ProviderCall,
  type PublicCallState,
} from './live-evidence';

/** Overridable so the durable chase can be exercised end to end against a local stand-in. */
const API_ORIGIN = process.env.KOL_CALLE_ORIGIN ?? 'https://api.heycall-e.com';

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

export async function createDemoCall(to: string, scenario: DemoScenario, idempotencyKey?: string): Promise<ProviderCall> {
  const request = scenario === 'claim_evidence'
    ? claimDemoRequest(to)
    : scenario === 'ivr_route'
      ? ivrRouteRequest(to)
      : reachabilityRequest(to);
  const hour = new Date().toISOString().slice(0, 13);
  const key = idempotencyKey ?? `kol-web-${createHash('sha256').update(`${JSON.stringify(request)}:${hour}`).digest('hex').slice(0, 32)}`;
  return calle('/v1/calls', { method: 'POST', body: JSON.stringify(request), headers: { 'Idempotency-Key': key } });
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

/**
 * A replay: the route is dictated up front from the atlas, so the agent should not explore.
 * The recipient reads a fictional two-level menu aloud and, after the second key, answers
 * as a representative. The task asks for keypad tones, and for a report of every menu heard
 * and every key pressed, which the gate later treats as the model's own testimony.
 */
function ivrRouteRequest(to: string) {
  const [first, second] = ROUTE_DEMO.keys;
  return {
    task: [
      `Place one authorised demonstration call. The line answers with the automated phone menu of ${ROUTE_DEMO.org}, read aloud by a participant using fictional data. No real medical data is involved.`,
      // A phone menu talks first and does not take turns. An agent that greets it, thanks it,
      // or answers it at a sentence boundary talks over the options it needs to hear.
      'When the call connects, do not speak. Listen silently. The menu is read sentence by sentence with pauses; a pause does not mean it has finished, and it is never your turn to talk while a menu is playing.',
      'Never reply to the menu, never thank it, and never make up menu prompts of your own.',
      'The route is already known, so do not explore other options. Your only actions on the menus are keypad presses.',
      `When you have heard the option for claims, press ${first} on the keypad by sending the DTMF tone. Do not say the number aloud.`,
      `Then listen silently to the next menu. When you have heard the option for the status of an existing claim, press ${second} on the keypad by sending the DTMF tone. Do not say the number aloud.`,
      'After the second key, a person answers. Only then speak: say that you are Kol, an automated assistant calling about a fictional claim.',
      `Then ask exactly: What is the current status of fictional claim ${CLAIM_DEMO.reference}?`,
      'Do not suggest the answer. Listen, repeat it once for confirmation, thank them, and end the call.',
      'Do not hang up while a menu is being read or during a pause. Only if there has been complete silence for 20 seconds, say once that you are Kol, an automated assistant, and keep listening.',
      'Report every menu you heard, what it said, and precisely which key you pressed at each one.',
      'Do not ask for a name, member ID, date of birth, health information, payment, or any other personal data.',
    ].join(' '),
    recipients: [{ phones: [to], region: to.startsWith('+91') ? 'IN' : 'US', locale: to.startsWith('+91') ? 'en-IN' : 'en-US' }],
    result_schema: {
      type: 'object',
      required: ['reached_target', 'menu_levels', 'claim_reference', 'claim_status', 'paid_amount', 'payment_date', 'target_name_used'],
      properties: {
        reached_target: { type: 'string', enum: ['yes', 'no', 'unclear'] },
        target_name_used: { type: 'string' },
        menu_levels: {
          type: 'array',
          items: {
            type: 'object',
            required: ['level', 'prompt_heard', 'action_type'],
            properties: {
              level: { type: 'integer' },
              prompt_heard: { type: 'string' },
              action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
              action_value: { type: 'string', description: 'The key pressed, when action_type is dtmf.' },
            },
          },
        },
        claim_reference: { type: 'string' },
        claim_status: { type: 'string', enum: ['paid', 'pending', 'denied', 'unknown'] },
        paid_amount: { type: 'string' },
        payment_date: { type: 'string' },
      },
    },
    metadata: { kol_scenario: 'fictional-ivr-route-demo', purpose: 'no-phi-route-replay-test' },
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
