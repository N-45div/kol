import { isReplayable, type Route } from '../atlas/types.ts';

/**
 * What this call is about to cost, before it is placed.
 *
 * Agents spend money and other people's time, and almost none of them say so first. The Atlas
 * already knows how long this line took the last few times and how much of that was hold, so
 * an operator can be told what to expect and decide whether it is worth it.
 *
 * The rule this module keeps: **never invent a number.** With no samples it says so. With
 * samples from a different mode it says that too, rather than quietly presenting an explore
 * timing as a replay estimate. A confident wrong estimate is worse than an honest blank.
 */

export const COST_PER_CALL_USD = 0.05;

export type EstimateBasis = 'measured' | 'other-mode' | 'none';

export interface Preflight {
  mode: 'explore' | 'replay';
  /** Expected wall-clock seconds, when we have grounds for a figure. */
  expectedSeconds?: number;
  /** The worst of what we have seen, so nobody is surprised by the tail. */
  worstSeconds?: number;
  /** Of that, how much is expected to be hold — time the agent absorbs and a person does not. */
  expectedHoldSeconds?: number;
  /** How many past calls the figure rests on. */
  samples: number;
  basis: EstimateBasis;
  costUsd: number;
  /** Seconds saved against this line's own explore timing, when both are measured. */
  savedVersusExploreSeconds?: number;
  summary: string;
}

export function preflight(route: Route | undefined): Preflight {
  const mode: 'explore' | 'replay' = isReplayable(route) ? 'replay' : 'explore';
  const observed = route?.observed;
  const own = observed?.[mode];
  const other = mode === 'replay' ? observed?.explore : observed?.replay;

  const base = {
    mode,
    costUsd: COST_PER_CALL_USD,
    ...(route?.hold ? { expectedHoldSeconds: Math.round(route.hold.p50Seconds) } : {}),
  };

  if (own && own.samples > 0) {
    const exploreP50 = observed?.explore?.p50Seconds;
    const saved = mode === 'replay' && exploreP50 !== undefined
      ? Math.max(0, Math.round(exploreP50 - own.p50Seconds))
      : undefined;
    return {
      ...base,
      expectedSeconds: Math.round(own.p50Seconds),
      worstSeconds: Math.round(own.p90Seconds),
      samples: own.samples,
      basis: 'measured',
      ...(saved !== undefined ? { savedVersusExploreSeconds: saved } : {}),
      summary: describe(mode, Math.round(own.p50Seconds), own.samples, saved, base.expectedHoldSeconds),
    };
  }

  if (other && other.samples > 0) {
    const otherMode = mode === 'replay' ? 'explore' : 'replay';
    return {
      ...base,
      samples: 0,
      basis: 'other-mode',
      summary:
        `No ${mode} call to this line has been timed yet. ${otherMode} took about ` +
        `${Math.round(other.p50Seconds)}s over ${other.samples} call${other.samples === 1 ? '' : 's'}; ` +
        `${mode} should differ, but by how much is unmeasured. About $${COST_PER_CALL_USD.toFixed(2)}.`,
    };
  }

  return {
    ...base,
    samples: 0,
    basis: 'none',
    summary:
      `This line has never been timed, so there is nothing to predict from. ` +
      `About $${COST_PER_CALL_USD.toFixed(2)}.`,
  };
}

function describe(
  mode: 'explore' | 'replay',
  seconds: number,
  samples: number,
  saved: number | undefined,
  hold: number | undefined,
): string {
  const parts = [
    `Expect about ${seconds}s on ${mode}, from ${samples} previous call${samples === 1 ? '' : 's'}.`,
  ];
  if (hold !== undefined) {
    parts.push(`Roughly ${hold}s of that is hold the agent waits through instead of a person.`);
  }
  if (saved !== undefined && saved > 0) {
    parts.push(`About ${saved}s shorter than exploring this line from scratch.`);
  }
  parts.push(`About $${COST_PER_CALL_USD.toFixed(2)}.`);
  return parts.join(' ');
}

/** One line for a terminal, printed before anything dials. */
export function renderPreflight(estimate: Preflight): string {
  const head = estimate.expectedSeconds !== undefined
    ? `~${estimate.expectedSeconds}s` + (estimate.worstSeconds !== undefined ? ` (worst seen ${estimate.worstSeconds}s)` : '')
    : 'unknown duration';
  return `  estimate   ${head}, ~$${estimate.costUsd.toFixed(2)}  ·  ${estimate.summary}`;
}
