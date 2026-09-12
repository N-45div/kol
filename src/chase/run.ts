import { Atlas } from '../atlas/store.ts';
import { compileTask } from '../atlas/compile.ts';
import { NAVIGATION_RESULT_SCHEMA } from '../atlas/schema.ts';
import type { DriftReport } from '../atlas/drift.ts';
import { isReplayable, type NavigationReport, type Route } from '../atlas/types.ts';
import { pollUntilTerminal } from '../calle/poll.ts';
import { allTurns, type CallRecord, type CalleTransport, type CreateCallRequest } from '../calle/types.ts';
import { assertNoPhi } from '../healthcare/phi.ts';
import { maskE164 } from '../util/mask.ts';
import { preflight, type Preflight } from './preflight.ts';
import { verifyAnswer, type Verification } from './verify.ts';

/**
 * One chase: ask one line one question, and come back with an answer you can defend.
 *
 * Explore or replay is decided by the Atlas, not by the caller — the point of the product is
 * that the second call to a line is cheaper without anyone having to remember that it is the
 * second call.
 */

export interface ChaseRequest {
  lineE164: string;
  org: string;
  /** Atlas key: what we are chasing on this line, e.g. "claim_status". */
  goal: string;
  /** The department to reach, in the words the menu uses. */
  targetName: string;
  /** The question to ask once a human answers. */
  question: string;
  /** A reference to quote, e.g. a claim number. */
  reference?: string;
  /** A phrase spoken only at the intended destination, if the line has one. */
  expectedLeafMarker?: string;
  minConfidence?: number;
}

export interface ChaseResult {
  scenario: string;
  mode: 'explore' | 'replay';
  callId: string;
  status: string;
  /** What the call reported about its own navigation. */
  navigation: NavigationReport;
  answer: string;
  verification: Verification;
  atlas: { outcome: 'learned' | 'confirmed' | 'repaired' | 'quarantined'; route?: Route; drift?: DriftReport };
  timing: { totalSeconds: number; holdSeconds?: number; keysPressed: string[] };
  /** True when a person must look at this before the answer is used. */
  needsHuman: boolean;
  task: string;
  /** What we told the operator this call would cost, before placing it. */
  estimate: Preflight;
}

export interface ChaseOptions {
  transport: CalleTransport;
  atlas: Atlas;
  /** Injected so results are reproducible under replay. */
  now: string;
  scenario?: string;
  webhookUrl?: string;
  onProgress?: (line: string) => void;
}

export async function runChase(request: ChaseRequest, opts: ChaseOptions): Promise<ChaseResult> {
  const { transport, atlas, now } = opts;

  // Everything below is spoken aloud to whoever answers. Refuse before anything is compiled.
  assertNoPhi({ question: request.question, reference: request.reference, target: request.targetName, org: request.org });

  await atlas.load();

  const known = atlas.get(request.lineE164, request.goal);
  const route = isReplayable(known) ? known : undefined;
  const { task, mode } = compileTask({
    question: request.question,
    targetName: route?.targetName ?? request.targetName,
    ...(request.reference ? { reference: request.reference } : {}),
    ...(route ? { route } : {}),
  });

  const scenario = opts.scenario ?? `chase-${request.goal}-${mode}`;
  const report = opts.onProgress ?? (() => {});
  report(`${mode === 'replay' ? 'Replaying a known route' : 'Exploring a new line'} — ${maskE164(request.lineE164)}`);
  if (route) report(`  route v${route.version}, confirmed ${route.confirmations}x: ${describeRoute(route)}`);

  // Say what this is expected to cost before it costs it.
  const estimate = preflight(known);
  report(`  ${estimate.summary}`);

  const create: CreateCallRequest = {
    task,
    recipients: [{ phones: [request.lineE164], region: 'US', locale: 'en-US' }],
    result_schema: NAVIGATION_RESULT_SCHEMA as unknown as Record<string, unknown>,
    metadata: {
      kol_scenario: scenario,
      kol_goal: request.goal,
      kol_mode: mode,
      ...(route ? { kol_route_version: route.version } : {}),
    },
    ...(opts.webhookUrl ? { webhook_url: opts.webhookUrl } : {}),
  };

  // The idempotency key is stable for a (line, goal, mode, hour): a retried process resumes
  // the same call instead of dialling a second time. Calls cost money and annoy people.
  const idempotencyKey = `kol-${request.goal}-${mode}-${request.lineE164.replace(/\D/g, '')}-${now.slice(0, 13)}`;

  const started = Date.now();
  const created = await transport.createCall(create, idempotencyKey);
  const callId = String(created.id ?? created.call_id ?? '');
  report(`  call ${callId || '(no id returned)'}`);

  const final = await pollUntilTerminal(transport, callId, {
    onProgress: (call, ms) => report(`  ${String(Math.round(ms / 1000)).padStart(4)}s  ${call.status ?? '...'}`),
  });
  const totalSeconds = Math.round((Date.now() - started) / 1000);

  const navigation = navigationFrom(final);
  const answer = String(navigation.final_answer ?? '').trim();

  const verification = verifyAnswer({
    call: final,
    answer,
    ...(request.expectedLeafMarker ? { expectedLeafMarker: request.expectedLeafMarker } : {}),
    ...(request.minConfidence !== undefined ? { minConfidence: request.minConfidence } : {}),
  });

  // Only a verified call may teach the Atlas. A contradicted call is precisely the one whose
  // route we must not learn — it is the evidence that the route led somewhere wrong.
  const atlasOutcome = verification.verdict === 'verified'
    ? await atlas.record({
        lineE164: request.lineE164,
        org: request.org,
        goal: request.goal,
        targetName: request.targetName,
        report: navigation,
        now,
        mode,
        totalSeconds,
        ...(navigation.hold_seconds_estimate !== undefined ? { holdSeconds: navigation.hold_seconds_estimate } : {}),
      })
    : await quarantine(atlas, request, navigation, now, verification.verdict);

  const keysPressed = (navigation.menu_levels ?? [])
    .filter((l) => l.action_type === 'dtmf' && l.action_value)
    .map((l) => String(l.action_value));

  return {
    scenario,
    mode,
    callId,
    status: String(final.status ?? 'unknown'),
    navigation,
    answer,
    verification,
    atlas: atlasOutcome,
    timing: {
      totalSeconds,
      ...(navigation.hold_seconds_estimate !== undefined ? { holdSeconds: navigation.hold_seconds_estimate } : {}),
      keysPressed,
    },
    needsHuman: verification.verdict !== 'verified',
    task,
    estimate,
  };
}

/**
 * A route that produced an unverified answer is marked stale rather than updated, so the next
 * chase explores instead of repeating a path we cannot vouch for.
 */
async function quarantine(
  atlas: Atlas,
  request: ChaseRequest,
  navigation: NavigationReport,
  now: string,
  verdict: string,
): Promise<ChaseResult['atlas']> {
  const existing = atlas.get(request.lineE164, request.goal);
  if (!existing) return { outcome: 'quarantined' };
  return atlas.record({
    lineE164: request.lineE164,
    org: request.org,
    goal: request.goal,
    targetName: request.targetName,
    // Force the store down its quarantine path: an answer we could not verify is, as far as
    // the Atlas is concerned, a call that did not reach the target.
    report: { ...navigation, reached_target: verdict === 'unreachable' ? 'no' : 'unclear' },
    now,
  });
}

function navigationFrom(call: CallRecord): NavigationReport {
  const top = call.structured_result as Partial<NavigationReport> | undefined;
  const perRecipient = call.recipients?.[0]?.structured_result as Partial<NavigationReport> | undefined;
  // A batch task reports per recipient; a single-recipient task reports at the top level.
  const source: Partial<NavigationReport> =
    (top && Object.keys(top).length > 0 ? top : perRecipient) ?? {};
  return {
    reached_target: (source.reached_target ?? 'unclear') as NavigationReport['reached_target'],
    ...(source.target_name_used ? { target_name_used: source.target_name_used } : {}),
    menu_levels: source.menu_levels ?? [],
    ...(source.hold_seconds_estimate !== undefined ? { hold_seconds_estimate: source.hold_seconds_estimate } : {}),
    ...(source.route_matched_expectation ? { route_matched_expectation: source.route_matched_expectation } : {}),
    ...(source.final_answer ? { final_answer: source.final_answer } : {}),
  };
}

function describeRoute(route: Route): string {
  return route.steps
    .map((s) => (s.action.type === 'dtmf' ? `press ${s.action.value}` : `say "${s.action.value}"`))
    .join(' then ');
}

/** Everything a human needs to judge the chase, without opening the transcript. */
export function renderChase(result: ChaseResult, call?: CallRecord): string {
  const v = result.verification;
  const lines: string[] = [];
  const badge = { verified: 'VERIFIED', contradicted: 'CONTRADICTED', unsupported: 'UNSUPPORTED', unreachable: 'NOT REACHED' }[v.verdict];

  lines.push('');
  lines.push(`  ${badge}   ${result.mode}   ${result.timing.totalSeconds}s total` +
    (result.timing.holdSeconds !== undefined ? `, ~${result.timing.holdSeconds}s on hold` : ''));
  lines.push('');

  if (result.navigation.menu_levels?.length) {
    lines.push('  Route taken');
    for (const level of result.navigation.menu_levels) {
      const action = level.action_type === 'dtmf'
        ? `pressed ${level.action_value}`
        : level.action_type === 'speech'
          ? `said "${level.action_value}"`
          : level.action_type;
      lines.push(`    ${level.level}. ${truncate(level.prompt_heard, 72)}`);
      lines.push(`       -> ${action}`);
    }
    lines.push('');
  }

  lines.push('  Answer');
  lines.push(`    ${result.answer || '(none given)'}`);
  if (v.supportingSpan) {
    lines.push(`    grounded at ${v.supportingSpan.offset_seconds}s: "${truncate(v.supportingSpan.text, 90)}"`);
  }
  lines.push('');

  lines.push('  Checks');
  for (const check of v.checks) {
    lines.push(`    ${check.passed ? 'ok  ' : 'FAIL'} ${check.name.padEnd(30)} ${check.detail}`);
  }
  lines.push('');
  lines.push(`  ${v.summary}`);

  const drift = result.atlas.drift;
  lines.push('');
  lines.push(`  Atlas: ${result.atlas.outcome}` +
    (result.atlas.route ? ` (v${result.atlas.route.version}, ${result.atlas.route.confirmations} confirmations)` : ''));
  if (drift && drift.kind !== 'none') {
    lines.push(`    drift: ${drift.kind}${drift.dangerous ? ' — DANGEROUS' : ''}`);
    lines.push(`    ${drift.summary}`);
  }

  if (result.needsHuman) {
    lines.push('');
    lines.push('  This chase is not safe to act on. Routed for human review.');
  }

  if (call) {
    const turns = allTurns(call);
    if (turns.length > 0) {
      lines.push('');
      lines.push('  Transcript (untrusted call data)');
      for (const turn of turns) {
        lines.push(`    ${String(turn.offset_seconds).padStart(4)}s ${turn.speaker.padEnd(5)} ${truncate(turn.text, 88)}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3)}...`;
}
