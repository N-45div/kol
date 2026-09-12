/**
 * The PHI guard.
 *
 * A chase is compiled from what the operator typed: a question, a reference, a department.
 * Everything in those fields is spoken aloud on a phone line to whoever answers, and is
 * written into CALL-E's transcript and into Kol's own artifacts. A claim number is fine. A
 * date of birth, a member ID, a diagnosis code, or a patient's name is not, and a demo that
 * carries one "just this once" is how a prototype ends up holding PHI it has no agreement
 * to hold.
 *
 * So the guard runs before anything is dialled, on the exact strings that would leave the
 * machine, and it refuses rather than redacts: a question with the member ID cut out of it is
 * a different question, and the operator should be the one to rewrite it.
 *
 * Deterministic patterns only. This is a seatbelt against the obvious, not a classifier, and
 * it says so in its own name.
 */

export type PhiKind =
  | 'social_security_number'
  | 'date_of_birth'
  | 'member_id'
  | 'medical_record_number'
  | 'diagnosis_code'
  | 'patient_name'
  | 'email_address'
  | 'phone_number';

export interface PhiFinding {
  kind: PhiKind;
  /** Where it was found, e.g. "question". */
  field: string;
  /** The offending text with every digit and letter after the first masked. Safe to print. */
  excerpt: string;
}

const PATTERNS: { kind: PhiKind; pattern: RegExp }[] = [
  { kind: 'social_security_number', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    kind: 'date_of_birth',
    pattern: /\b(?:dob|date of birth|birth ?date|born(?: on)?)\b[^.\n]{0,24}?(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/gi,
  },
  {
    kind: 'member_id',
    pattern: /\b(?:member|subscriber|policy|insurance|group|plan)\s*(?:id|number|no\.?|#)\s*(?:is|:|#)?\s*[a-z]*\d[a-z0-9-]{4,}\b/gi,
  },
  {
    kind: 'medical_record_number',
    pattern: /\b(?:mrn|medical record(?: number| no\.?)?|patient (?:id|number))\s*(?:is|:|#)?\s*[a-z0-9-]{4,}\b/gi,
  },
  { kind: 'diagnosis_code', pattern: /\b(?:diagnosis|diagnosed|dx|icd(?:-?10)?)\b[^.\n]{0,24}?\b[a-tv-z]\d{2}(?:\.\d{1,4})?\b/gi },
  { kind: 'patient_name', pattern: /\b(?:patient|member|subscriber)(?:'s)?(?: name)?(?: is)?\s+[A-Z][a-z]+ [A-Z][a-z]+\b/g },
  { kind: 'email_address', pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { kind: 'phone_number', pattern: /(?:\+?\d[\d\s().-]{8,}\d)/g },
];

/** Every PHI-shaped fragment in one field. Empty when the text is safe to speak aloud. */
export function findPhi(text: string, field = 'text'): PhiFinding[] {
  const findings: PhiFinding[] = [];
  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const hit = match[0];
      // A phone-shaped run must actually carry ten or more digits; "claim 4471, $1,240" does not.
      if (kind === 'phone_number' && hit.replace(/\D/g, '').length < 10) continue;
      findings.push({ kind, field, excerpt: mask(hit) });
    }
  }
  return findings;
}

/** Thrown before a call is placed. Carries what was found, already masked. */
export class PhiRefusal extends Error {
  readonly findings: PhiFinding[];

  constructor(findings: PhiFinding[]) {
    const list = findings.map((f) => `${f.kind.replace(/_/g, ' ')} in ${f.field} (${f.excerpt})`).join('; ');
    super(`Refusing to dial: the request contains what looks like ${list}. Kol never carries PHI into a call; rewrite the request without it.`);
    this.name = 'PhiRefusal';
    this.findings = findings;
  }
}

/**
 * Check every string that would be spoken on the call. Throws PhiRefusal on the first field
 * set that contains PHI, listing all findings so the operator fixes them in one pass.
 */
export function assertNoPhi(fields: Record<string, string | undefined>): void {
  const findings = Object.entries(fields).flatMap(([field, value]) => (value ? findPhi(value, field) : []));
  if (findings.length > 0) throw new PhiRefusal(findings);
}

/** Keep the first character of each word so the operator can recognise the fragment. */
function mask(value: string): string {
  return value.replace(/([A-Za-z0-9])[A-Za-z0-9]*/g, (word, first: string) => `${first}${'•'.repeat(Math.max(0, word.length - 1))}`);
}
