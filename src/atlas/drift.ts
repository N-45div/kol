import { extractOptions, type MenuOption } from './fingerprint.ts';
import type { NavigationReport, Route } from './types.ts';

/**
 * Drift classification.
 *
 * Not all changes to a phone tree are equally dangerous, and lumping them together is what
 * makes cached routes untrustworthy. A reworded greeting is noise. A remapped digit is a
 * cached route that now confidently walks into the wrong department and may still come back
 * with a plausible-sounding answer — the worst possible failure for a system whose output
 * feeds a business decision.
 */

export type DriftKind =
  | 'none'
  | 'reworded'
  | 'remapped'
  | 'restructured'
  | 'unreadable';

export interface LevelDrift {
  level: number;
  kind: DriftKind;
  expected: MenuOption[];
  observed: MenuOption[];
  detail: string;
}

export interface DriftReport {
  kind: DriftKind;
  /** True when a cached replay could have gone somewhere it did not intend. */
  dangerous: boolean;
  levels: LevelDrift[];
  summary: string;
}

const SEVERITY: Record<DriftKind, number> = {
  none: 0,
  reworded: 1,
  unreadable: 2,
  remapped: 3,
  restructured: 3,
};

function classifyLevel(expected: MenuOption[], observed: MenuOption[]): { kind: DriftKind; detail: string } {
  if (observed.length === 0) {
    return { kind: 'unreadable', detail: 'no option/key pairs could be read from what was heard' };
  }
  if (expected.length === 0) {
    return { kind: 'unreadable', detail: 'no stored option/key pairs to compare against' };
  }

  const expByLabel = new Map(expected.map((o) => [o.label, o.digit]));
  const obsByLabel = new Map(observed.map((o) => [o.label, o.digit]));

  const remapped: string[] = [];
  for (const [label, digit] of expByLabel) {
    const now = obsByLabel.get(label);
    if (now !== undefined && now !== digit) remapped.push(`"${label}" moved from ${digit} to ${now}`);
  }
  if (remapped.length > 0) {
    return { kind: 'remapped', detail: remapped.join('; ') };
  }

  const sameLabels =
    expByLabel.size === obsByLabel.size && [...expByLabel.keys()].every((l) => obsByLabel.has(l));
  if (sameLabels) {
    return { kind: 'none', detail: 'option mapping unchanged' };
  }

  const expByDigit = new Map(expected.map((o) => [o.digit, o.label]));
  const obsByDigit = new Map(observed.map((o) => [o.digit, o.label]));
  const sameDigits =
    expByDigit.size === obsByDigit.size && [...expByDigit.keys()].every((d) => obsByDigit.has(d));
  if (sameDigits) {
    return { kind: 'reworded', detail: 'same keys, different wording' };
  }

  const added = [...obsByLabel.keys()].filter((l) => !expByLabel.has(l));
  const removed = [...expByLabel.keys()].filter((l) => !obsByLabel.has(l));
  return {
    kind: 'restructured',
    detail: `added [${added.join(', ')}], removed [${removed.join(', ')}]`,
  };
}

export function detectDrift(route: Route, report: NavigationReport): DriftReport {
  const heardLevels = report.menu_levels ?? [];
  const levels: LevelDrift[] = [];

  const depth = Math.max(route.steps.length, heardLevels.length);
  for (let i = 0; i < depth; i++) {
    const stored = route.steps[i];
    const heard = heardLevels[i];
    const expected = stored ? extractOptions(stored.heard) : [];
    const observed = heard ? extractOptions(heard.prompt_heard) : [];

    if (!stored || !heard) {
      levels.push({
        level: i + 1,
        kind: 'restructured',
        expected,
        observed,
        detail: !stored ? 'the tree grew a level we have never seen' : 'a level we expected was not heard',
      });
      continue;
    }
    const { kind, detail } = classifyLevel(expected, observed);
    levels.push({ level: i + 1, kind, expected, observed, detail });
  }

  const worst = levels.reduce<DriftKind>(
    (acc, l) => (SEVERITY[l.kind] > SEVERITY[acc] ? l.kind : acc),
    'none',
  );

  // The call itself is the other witness: if it followed our route and did not land where it
  // expected, that is drift regardless of what we could parse from the prompts.
  const contradicted =
    report.route_matched_expectation === 'no' || report.reached_target === 'no';
  const kind: DriftKind = contradicted && worst === 'none' ? 'restructured' : worst;

  const dangerous = kind === 'remapped' || kind === 'restructured';
  const changed = levels.filter((l) => l.kind !== 'none');

  return {
    kind,
    dangerous,
    levels,
    summary:
      kind === 'none'
        ? 'Tree unchanged; route still valid.'
        : `${kind}: ${changed.map((l) => `level ${l.level} — ${l.detail}`).join(' | ')}`,
  };
}
