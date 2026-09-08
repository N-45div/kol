import type { Atlas } from '../atlas/store.ts';
import { calleeTurns, type CallRecord } from '../calle/types.ts';
import { runChase, type ChaseOptions, type ChaseRequest, type ChaseResult } from './run.ts';

/**
 * What to do when the answer cannot be trusted.
 *
 * Detecting a bad answer is only half a system. The other half is deciding what happens next,
 * and the tempting answer — try again — is how an agent dials a stranger five times.
 *
 * The ladder is two rungs and then a person:
 *
 *   1. A **replay** that came back contradicted is most likely a stale route, so it is worth
 *      exactly one retry with the route ignored and the tree read fresh.
 *   2. An **explore** that came back contradicted has no route to blame. Retrying would ask
 *      the same question the same way and get the same answer, so it stops immediately.
 *
 * Never a third call. Two attempts and a human, with everything the human needs attached.
 */

export interface EvidencePacket {
  /** Why a person is being asked to look at this. */
  reason: string;
  attempts: {
    mode: 'explore' | 'replay';
    callId: string;
    verdict: string;
    answer: string;
    failedChecks: { name: string; detail: string }[];
    /** Numbers the answer asserted that nobody said. Usually the fastest tell. */
    unsupportedNumbers: string[];
    /** What the other side actually said, so the human can judge for themselves. */
    calleeTurns: { atSeconds: number; text: string }[];
  }[];
  /** The route in play when this started, if there was one. */
  routeAtFailure?: { version: number; steps: string; fingerprint: string };
  /** What the Atlas did as a result. */
  atlasOutcome: string;
}

export interface EscalationResult {
  /** Every attempt made, in order. Never more than two. */
  attempts: ChaseResult[];
  /** The attempt whose answer should be used, or the last one if none can be. */
  final: ChaseResult;
  /** True when a second call was placed because the first was contradicted. */
  escalated: boolean;
  /** Present only when a person still has to decide. */
  packet?: EvidencePacket;
  callsPlaced: number;
}

export interface EscalateOptions extends ChaseOptions {
  /** Set false to disable the retry entirely, e.g. when the call budget is nearly spent. */
  allowRetry?: boolean;
  /** Records of the calls, for the evidence packet. Optional; the packet degrades gracefully. */
  fetchCall?: (callId: string) => Promise<CallRecord | undefined>;
}

export async function runChaseWithEscalation(
  request: ChaseRequest,
  opts: EscalateOptions,
): Promise<EscalationResult> {
  const attempts: ChaseResult[] = [];
  const first = await runChase(request, opts);
  attempts.push(first);

  if (first.verification.verdict === 'verified') {
    return { attempts, final: first, escalated: false, callsPlaced: 1 };
  }

  // Only a contradicted replay earns a retry: the route is the thing we can change.
  const worthRetrying =
    first.mode === 'replay'
    && first.verification.verdict === 'contradicted'
    && opts.allowRetry !== false;

  if (!worthRetrying) {
    return {
      attempts,
      final: first,
      escalated: false,
      packet: await buildPacket(attempts, reasonFor(first, false), opts),
      callsPlaced: 1,
    };
  }

  // The route that produced the contradicted answer has already been quarantined by the
  // runner, so this chase compiles as an explore and reads the tree fresh.
  opts.onProgress?.('route quarantined — retrying once from scratch before asking a person');
  const second = await runChase(request, {
    ...opts,
    scenario: `${opts.scenario ?? `chase-${request.goal}`}-escalated`,
  });
  attempts.push(second);

  if (second.verification.verdict === 'verified') {
    return { attempts, final: second, escalated: true, callsPlaced: 2 };
  }

  return {
    attempts,
    final: second,
    escalated: true,
    packet: await buildPacket(attempts, reasonFor(second, true), opts),
    callsPlaced: 2,
  };
}

function reasonFor(result: ChaseResult, afterRetry: boolean): string {
  const verdict = result.verification.verdict;
  if (verdict === 'unreachable') {
    return 'Nobody answered, so there is no answer to check. A person should decide whether to try again later.';
  }
  if (verdict === 'contradicted') {
    return afterRetry
      ? 'Two calls came back with answers the transcript does not support. This is not a stale route; something about the line or the question is wrong.'
      : 'The answer is not supported by what the callee said, and there was no cached route to blame.';
  }
  return afterRetry
    ? 'Neither call produced an answer clearly grounded in the transcript.'
    : 'Nothing the callee said clearly supports this answer.';
}

async function buildPacket(
  attempts: ChaseResult[],
  reason: string,
  opts: EscalateOptions,
): Promise<EvidencePacket> {
  const rows: EvidencePacket['attempts'] = [];

  for (const attempt of attempts) {
    const call = await opts.fetchCall?.(attempt.callId).catch(() => undefined);
    rows.push({
      mode: attempt.mode,
      callId: attempt.callId,
      verdict: attempt.verification.verdict,
      answer: attempt.answer,
      failedChecks: attempt.verification.checks
        .filter((check) => !check.passed)
        .map((check) => ({ name: check.name, detail: check.detail })),
      unsupportedNumbers: attempt.verification.unsupportedNumbers,
      calleeTurns: call
        ? calleeTurns(call).map((turn) => ({ atSeconds: turn.offset_seconds, text: turn.text }))
        : [],
    });
  }

  const routeUsed = attempts[0]?.atlas.route;
  return {
    reason,
    attempts: rows,
    ...(routeUsed
      ? {
          routeAtFailure: {
            version: routeUsed.version,
            steps: routeUsed.steps
              .map((step) => (step.action.type === 'dtmf' ? `press ${step.action.value}` : `say "${step.action.value}"`))
              .join(' then '),
            fingerprint: routeUsed.fingerprint,
          },
        }
      : {}),
    atlasOutcome: attempts[attempts.length - 1]?.atlas.outcome ?? 'unknown',
  };
}

/** The packet as something a person can read in a terminal or paste into a ticket. */
export function renderPacket(packet: EvidencePacket): string {
  const lines: string[] = ['', '  NEEDS A PERSON', '', `  ${packet.reason}`, ''];

  if (packet.routeAtFailure) {
    lines.push(`  Route in play: v${packet.routeAtFailure.version} — ${packet.routeAtFailure.steps}`);
    lines.push(`  Atlas outcome: ${packet.atlasOutcome}`);
    lines.push('');
  }

  packet.attempts.forEach((attempt, index) => {
    lines.push(`  Attempt ${index + 1} — ${attempt.mode}, ${attempt.verdict}`);
    lines.push(`    answer: ${attempt.answer || '(none given)'}`);
    if (attempt.unsupportedNumbers.length > 0) {
      lines.push(`    numbers nobody said: ${attempt.unsupportedNumbers.join(', ')}`);
    }
    for (const check of attempt.failedChecks) {
      lines.push(`    failed: ${check.name} — ${check.detail}`);
    }
    if (attempt.calleeTurns.length > 0) {
      lines.push('    what they actually said:');
      for (const turn of attempt.calleeTurns) {
        lines.push(`      ${String(turn.atSeconds).padStart(4)}s  ${turn.text}`);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}
