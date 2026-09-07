import type {
  CallEvent,
  CallRecord,
  CalleTransport,
  CreateCallRequest,
} from './types.ts';
import { Recorder } from './recorder.ts';

/**
 * Live CALL-E Developer API transport. Real phone calls, real money.
 *
 * Two rules this class exists to enforce:
 *   1. Nothing leaves without an Idempotency-Key. A retried POST that places a second call
 *      is not a bug we can afford at $0.05 and 20 calls.
 *   2. Nothing comes back without being written to artifacts/ first. If the process dies
 *      after a call completes, the transcript must survive.
 */
export class LiveCalle implements CalleTransport {
  readonly mode = 'live' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly recorder: Recorder;
  /** callId -> scenario, so polls file next to the create that produced them. */
  private readonly scenarioOf = new Map<string, string>();

  constructor(opts: { apiKey: string; baseUrl?: string; artifactsRoot: string }) {
    if (!opts.apiKey) {
      throw new Error(
        'CALLE_API_KEY is not set. Get one at https://dashboard.heycall-e.com/account/api-keys, ' +
          'or run in replay mode (KOL_MODE=replay) which needs no credentials.',
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.heycall-e.com').replace(/\/$/, '');
    this.recorder = new Recorder(opts.artifactsRoot);
  }

  private async request<T>(
    path: string,
    init: RequestInit & { idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

    // Safe to retry: GETs are read-only and POSTs carry an idempotency key.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
        const text = await res.text();
        if (res.status >= 500 || res.status === 429) {
          lastError = new Error(`CALL-E ${res.status} on ${path}: ${text.slice(0, 300)}`);
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          throw new Error(`CALL-E ${res.status} on ${path}: ${text.slice(0, 500)}`);
        }
        return (text ? JSON.parse(text) : {}) as T;
      } catch (err) {
        lastError = err;
        if (attempt === 2) break;
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async createCall(req: CreateCallRequest, idempotencyKey: string): Promise<CallRecord> {
    const scenario = scenarioKey(req);
    await this.recorder.record(scenario, 'request', { ...req, idempotency_key: idempotencyKey });

    const call = await this.request<CallRecord>('/v1/calls', {
      method: 'POST',
      body: JSON.stringify(req),
      idempotencyKey,
    });

    const callId = callIdOf(call);
    if (callId) this.scenarioOf.set(callId, scenario);
    await this.recorder.record(scenario, 'create', call, callId);
    return call;
  }

  /**
   * Bind an already-created call to a scenario so its polls are recorded. Needed when a
   * process dies mid-call, or when resuming a call created by another run: the call keeps
   * going on CALL-E's side regardless, and its transcript is the expensive part.
   */
  adopt(callId: string, scenario: string): void {
    this.scenarioOf.set(callId, scenario);
  }

  async getCall(callId: string): Promise<CallRecord> {
    const call = await this.request<CallRecord>(`/v1/calls/${encodeURIComponent(callId)}`);
    const scenario = this.scenarioOf.get(callId);
    if (scenario) await this.recorder.record(scenario, 'poll', call, callId);
    return call;
  }

  async getEvents(callId: string): Promise<CallEvent[]> {
    const res = await this.request<CallEvent[] | { events?: CallEvent[] }>(
      `/v1/calls/${encodeURIComponent(callId)}/events`,
    );
    const events = Array.isArray(res) ? res : (res.events ?? []);
    const scenario = this.scenarioOf.get(callId);
    if (scenario) await this.recorder.record(scenario, 'events', events, callId);
    return events;
  }
}

/**
 * The README documents `call_id`; the live API returns `id` (verified Sep 5 2026, probe P2).
 * Accept both so a documentation fix upstream cannot break us.
 */
export function callIdOf(call: CallRecord): string {
  return String(call.id ?? call.call_id ?? '');
}

/**
 * Every request must name the scenario it belongs to, so the recording can be replayed
 * later by name. Not optional: an unnamed live call is an unreplayable one.
 */
export function scenarioKey(req: CreateCallRequest): string {
  const key = req.metadata?.['kol_scenario'];
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('metadata.kol_scenario is required on every call, for replay.');
  }
  return key.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
