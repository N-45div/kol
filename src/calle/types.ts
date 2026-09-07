/**
 * CALL-E Developer API shapes.
 *
 * Sourced from CALLE-AI/call-e-integrations README (Sep 4 2026) and verified against live
 * responses as probes land. Anything not yet seen on the wire is marked UNVERIFIED so we
 * never quietly depend on a field that does not exist.
 */

export type JsonSchema = Record<string, unknown>;

export interface Recipient {
  phones: string[];
  /** ISO country code, e.g. "US". India is "IN" but rides an International line. */
  region?: string;
  /** e.g. "en-US". */
  locale?: string;
}

export interface CreateCallRequest {
  task: string;
  recipients: Recipient[];
  /** Task-level structured result. */
  result_schema?: JsonSchema;
  /** Per-recipient structured result. */
  recipient_result_schema?: JsonSchema;
  metadata?: Record<string, unknown>;
  webhook_url?: string;
}

/**
 * Terminal statuses. The CLI documents these uppercase; REST returns them lowercase in the
 * published example. Compare case-insensitively via isTerminal().
 */
export const TERMINAL_STATUSES = [
  'completed',
  'failed',
  'no_answer',
  'declined',
  'canceled',
  'cancelled',
  'voicemail',
  'busy',
  'expired',
] as const;

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export function isTerminal(status: string | undefined): boolean {
  if (!status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(status.toLowerCase());
}

/** A call reached a human and finished the goal, as opposed to merely ending. */
export function isAnswered(status: string | undefined): boolean {
  return status?.toLowerCase() === 'completed';
}

export interface TranscriptTurn {
  offset_seconds: number;
  speaker: 'bot' | 'user' | string;
  text: string;
}

export interface CallAttempt {
  transcript_turns?: TranscriptTurn[];
  [k: string]: unknown;
}

export interface RecipientResult {
  /** VERIFIED: e.g. "rcp_0213cc97174a57f0". */
  id?: string;
  phones?: string[];
  locale?: string;
  region?: string;
  /** VERIFIED: "pending" before dialling. */
  status?: string;
  summary?: string | null;
  structured_result?: Record<string, unknown> | null;
  attempts?: CallAttempt[];
  [k: string]: unknown;
}

export interface CompletionConfidence {
  score: number;
  label: string;
}

export interface CallRecord {
  /** VERIFIED (P2, Sep 5 2026): the live API returns `id`. */
  id?: string;
  /** As documented in the README; not observed on the wire. Kept for compatibility. */
  call_id?: string;
  /** VERIFIED: "call_task". */
  object?: string;
  /** VERIFIED: "queued" on create. */
  status?: string;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at?: string;
  completed_at?: string | null;
  task_completed?: boolean;
  completion_confidence?: CompletionConfidence;
  /** Free-text justifications the model attached to the result. Not a transcript span. */
  evidence?: string[];
  structured_result?: Record<string, unknown>;
  recipients?: RecipientResult[];
  summary?: string;
  post_summary?: string;
  /** UNVERIFIED: shape of activity/timeline on the REST path. */
  activity?: unknown[];
  [k: string]: unknown;
}

export interface CallEvent {
  [k: string]: unknown;
}

/**
 * The one interface the whole app talks to. Live and replay both implement it, so nothing
 * above this layer can tell whether a real phone rang.
 */
export interface CalleTransport {
  readonly mode: 'live' | 'replay';
  createCall(req: CreateCallRequest, idempotencyKey: string): Promise<CallRecord>;
  getCall(callId: string): Promise<CallRecord>;
  getEvents(callId: string): Promise<CallEvent[]>;
}

/** Every transcript turn across every attempt, flattened in order. */
export function allTurns(call: CallRecord): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const r of call.recipients ?? []) {
    for (const a of r.attempts ?? []) {
      for (const t of a.transcript_turns ?? []) turns.push(t);
    }
  }
  return turns.sort((a, b) => a.offset_seconds - b.offset_seconds);
}

/** Only what the callee's side said. This is the untrusted channel. */
export function calleeTurns(call: CallRecord): TranscriptTurn[] {
  return allTurns(call).filter((t) => t.speaker !== 'bot');
}
