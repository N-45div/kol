import type { CallRecord, CalleTransport } from './types.ts';
import { isTerminal } from './types.ts';

export interface PollOptions {
  /** CALL-E recommends waiting ~60s before the first poll. */
  firstDelayMs?: number;
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (call: CallRecord, elapsedMs: number) => void;
}

/**
 * Poll to a terminal status.
 *
 * The MCP path has no webhook, so polling is the only completion signal there; on REST a
 * webhook is better but still needs this as the fallback when a tunnel is down. Replay runs
 * the same loop with the waiting removed, so a recorded chase reproduces its own timeline
 * without costing three minutes of anyone's life.
 */
export async function pollUntilTerminal(
  transport: CalleTransport,
  callId: string,
  opts: PollOptions = {},
): Promise<CallRecord> {
  const live = transport.mode === 'live';
  const firstDelay = opts.firstDelayMs ?? (live ? 60_000 : 0);
  const interval = opts.intervalMs ?? (live ? 8_000 : 0);
  const timeout = opts.timeoutMs ?? 15 * 60_000;

  const started = Date.now();
  if (firstDelay > 0) await sleep(firstDelay);

  let last: CallRecord = {};
  while (Date.now() - started < timeout) {
    last = await transport.getCall(callId);
    opts.onProgress?.(last, Date.now() - started);
    if (isTerminal(last.status)) return last;
    if (interval > 0) await sleep(interval);
    else if (transport.mode === 'replay') {
      // Replay advances a cursor per call; if it has stopped moving we are at the end.
      const next = await transport.getCall(callId);
      opts.onProgress?.(next, Date.now() - started);
      if (isTerminal(next.status) || JSON.stringify(next) === JSON.stringify(last)) return next;
      last = next;
    }
  }
  throw new Error(
    `Call ${callId} did not reach a terminal status within ${Math.round(timeout / 1000)}s. ` +
      `The run_id is preserved — resume polling rather than placing a second call.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
