import { createHash } from 'node:crypto';
import type { RouteStep } from './types.ts';

/**
 * Menu fingerprinting.
 *
 * The naive approach hashes the transcript of the greeting, which changes every call — a new
 * holiday message, a reworded apology, a transcription wobble — and reports drift constantly.
 * Useless.
 *
 * What actually matters is the mapping from option label to key. "For claims, press 2" and
 * "Claims? Press 2." are the same tree. "For claims, press 3" is a different tree, and it is
 * the dangerous kind: a cached route that presses 2 now lands somewhere else entirely and may
 * still sound plausible. So the fingerprint is built from the extracted (label -> digit)
 * pairs, not the prose.
 */

export interface MenuOption {
  label: string;
  digit: string;
}

const FILLER = [
  'please listen carefully',
  'our menu options have recently changed',
  'our menu options have changed',
  'thank you for calling',
  'your call is important to us',
];

export function normalisePrompt(text: string): string {
  let out = text.toLowerCase();
  for (const f of FILLER) out = out.split(f).join(' ');
  return out
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

function toDigit(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (/^\d$/.test(t)) return t;
  return SPOKEN_DIGITS[t] ?? null;
}

/**
 * Pull (label, digit) pairs out of a menu prompt. Handles both orderings a real IVR uses:
 * "for claims, press 2" and "press 2 for claims".
 */
export function extractOptions(promptHeard: string): MenuOption[] {
  const text = normalisePrompt(promptHeard);

  const forFirst = /(?:for|to)\s+([a-z][a-z\s]{1,40}?)\s+press\s+([a-z]+|\d)/g;
  const pressFirst = /press\s+([a-z]+|\d)\s+(?:for|to)\s+([a-z][a-z\s]{1,40}?)(?=\s+(?:for|to|press)\s|$)/g;

  // The two phrasings overlap: in "press 1 for eligibility press 2 for claims", the
  // for-first pattern also matches "for eligibility press 2" and pairs the label with the
  // NEXT option's key — a silent off-by-one that reads as a remapped menu and would fire a
  // false drift alarm on every call. Decide which phrasing this menu actually uses by
  // counting complete matches of each, and parse with that one alone.
  const forFirstHits = [...text.matchAll(forFirst)];
  const pressFirstHits = [...text.matchAll(pressFirst)];

  const found = new Map<string, string>();
  const useForFirst = forFirstHits.length >= pressFirstHits.length;

  if (useForFirst) {
    for (const m of forFirstHits) {
      const digit = toDigit(m[2] ?? '');
      const label = (m[1] ?? '').trim();
      if (digit && label) found.set(label, digit);
    }
  } else {
    for (const m of pressFirstHits) {
      const digit = toDigit(m[1] ?? '');
      const label = (m[2] ?? '').trim();
      if (digit && label) found.set(label, digit);
    }
  }

  return [...found.entries()]
    .map(([label, digit]) => ({ label, digit }))
    .sort((a, b) => (a.digit === b.digit ? a.label.localeCompare(b.label) : a.digit.localeCompare(b.digit)));
}

/** Stable hash over the whole tree's option mapping, level by level. */
export function fingerprintSteps(steps: RouteStep[]): string {
  const parts = steps.map((s) => {
    const options = s.optionsOffered?.length
      ? s.optionsOffered.map((o) => normalisePrompt(o)).sort()
      : extractOptions(s.heard).map((o) => `${o.label}:${o.digit}`);
    return `L${s.level}|${options.join(',')}`;
  });
  return createHash('sha256').update(parts.join('||')).digest('hex').slice(0, 16);
}

export function fingerprintPrompt(promptHeard: string): string {
  const options = extractOptions(promptHeard).map((o) => `${o.label}:${o.digit}`);
  const basis = options.length > 0 ? options.join(',') : normalisePrompt(promptHeard);
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}
