/**
 * The Route Atlas: what Kol remembers about a phone tree between calls.
 *
 * A route is keyed by (line, goal). It is not a script — CALL-E decides what to do in the
 * moment — it is a hint precise enough to skip the exploring, plus enough recorded detail to
 * notice when the tree has changed underneath us.
 */

export type ActionType = 'dtmf' | 'speech' | 'wait' | 'none';

export interface RouteAction {
  type: ActionType;
  /** The key pressed, or the phrase spoken. Empty for wait/none. */
  value: string;
}

/** One level of the menu, as it was actually heard on a call. */
export interface RouteStep {
  level: number;
  /** Verbatim prompt text, as transcribed. Untrusted call data. */
  heard: string;
  /** Option labels offered at this level, if the call reported them. */
  optionsOffered?: string[];
  action: RouteAction;
  /** Why we believe this step: the transcript offset it was grounded in. */
  groundedAtSeconds?: number;
}

export type RouteStatus = 'fresh' | 'stale' | 'repairing' | 'unproven';

export interface HoldStats {
  samples: number;
  p50Seconds: number;
  p90Seconds: number;
}

export interface Route {
  /** E.164. Masked whenever displayed or written to a committed artifact. */
  lineE164: string;
  /** Human label for the organisation. Fictional in every sample. */
  org: string;
  /** What we were trying to reach, e.g. "claim_status". Half the atlas key. */
  goal: string;
  /** The target department in the words that worked on the line. */
  targetName: string;
  steps: RouteStep[];
  hold?: HoldStats;
  /** Hash over the menu structure. Drift is detected by comparing this. */
  fingerprint: string;
  version: number;
  status: RouteStatus;
  firstObservedAt: string;
  lastVerifiedAt: string;
  /** Calls that followed this route to the target without correction. */
  confirmations: number;
  /** Calls where the route was followed and the tree had moved. */
  corrections: number;
  /** Proof the leaf was actually reached, when the line offers one. */
  leafEvidence?: string;
}

export function routeKey(lineE164: string, goal: string): string {
  return `${lineE164}::${goal}`;
}

/** A route worth replaying: proven at least once and not known to be stale. */
export function isReplayable(route: Route | undefined): route is Route {
  if (!route) return false;
  if (route.status !== 'fresh') return false;
  if (route.steps.length === 0) return false;
  return route.confirmations > 0;
}

/**
 * What a single call reports back about its own navigation. This is the shape we ask CALL-E
 * to fill via result_schema, and the only structured account we get of what happened between
 * dialling and reaching a human.
 */
export interface NavigationReport {
  reached_target: 'yes' | 'no' | 'unclear';
  target_name_used?: string;
  menu_levels?: {
    level: number;
    prompt_heard: string;
    options_offered?: string[];
    action_type: ActionType;
    action_value?: string;
  }[];
  hold_seconds_estimate?: number;
  route_matched_expectation?: 'yes' | 'no' | 'not_applicable';
  final_answer?: string;
}
