/**
 * Numbers, spoken and written.
 *
 * The answers Kol collects are almost entirely numbers: a claim number, an amount, a
 * reference, a date. Numbers are also the part a language model is most likely to get subtly
 * wrong — and the part where being wrong actually costs someone money. So verification turns
 * on one rule: every number in the reported answer must have been said by the callee.
 *
 * That requires hearing "four four seven one" and "one thousand two hundred and forty" as
 * 4471 and 1240, because that is how a person reads a claim number and an amount aloud.
 */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

/** Ordinals a date is read with. "twelfth" -> 12, so "August twelfth" yields 12. */
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, thirtieth: 30,
};

/**
 * Split on punctuation before parsing.
 *
 * People separate a spoken identifier from a spoken amount with a pause, and a transcript
 * writes that pause as a comma. Without the split, "claim four four seven one, one thousand
 * two hundred and forty dollars" runs together into 44711 and 17240 — two numbers nobody said,
 * which would then be reported as unsupported and flag a perfectly honest answer.
 */
function segments(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[,;:.!?()\[\]{}"']|\s-\s|\bdollars?\b|\brupees?\b/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function words(text: string): string[] {
  return text
    .replace(/[^a-z0-9\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Every number a piece of text asserts, as canonical strings.
 *
 * Digits written as digits are taken literally (commas and currency stripped). Runs of spoken
 * single digits become one number, the way an identifier is read out. Cardinal phrases are
 * summed. Both readings of an ambiguous run are kept — "four four seven one" yields 4471 and
 * also 4, 47, 471 as prefixes are NOT added, but the individual digits are, since a callee
 * may have said them as separate values.
 */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();

  // Literal digits, including 1,240 and $1240.50 and 4471.
  for (const match of text.toLowerCase().matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const cleaned = match[0].replace(/,/g, '').replace(/\.0+$/, '');
    if (cleaned) out.add(trimNumber(cleaned));
  }

  for (const segment of segments(text)) {
    const tokens = words(segment);

    // Runs of single spoken digits: "four four seven one" -> 4471, plus each digit alone.
    // A unit immediately followed by a scale word belongs to a cardinal phrase, not the run:
    // in "seven one thousand", the "one" is part of "one thousand".
    let run: number[] = [];
    const flushRun = () => {
      if (run.length >= 2) out.add(run.join(''));
      if (run.length === 1) out.add(String(run[0]));
      run = [];
    };
    tokens.forEach((token, index) => {
      const digit = UNITS[token];
      const nextIsScale = SCALES[tokens[index + 1] ?? ''] !== undefined;
      if (digit !== undefined && digit <= 9 && !nextIsScale) {
        run.push(digit);
        return;
      }
      flushRun();
    });
    flushRun();

    // Cardinal phrases: "one thousand two hundred and forty" -> 1240.
    let total = 0;
    let current = 0;
    let seen = false;
    const flushCardinal = () => {
      if (seen) {
        const value = total + current;
        if (value > 0) out.add(String(value));
      }
      total = 0;
      current = 0;
      seen = false;
    };
    for (const token of tokens) {
      if (token === 'and' && seen) continue;
      if (UNITS[token] !== undefined) {
        current += UNITS[token]!;
        seen = true;
        continue;
      }
      if (TENS[token] !== undefined) {
        current += TENS[token]!;
        seen = true;
        continue;
      }
      if (SCALES[token] !== undefined) {
        const scale = SCALES[token]!;
        if (scale === 100) {
          current = (current || 1) * 100;
        } else {
          total += (current || 1) * scale;
          current = 0;
        }
        seen = true;
        continue;
      }
      flushCardinal();
    }
    flushCardinal();

    // Ordinals, for spoken dates.
    for (const token of tokens) {
      if (ORDINALS[token] !== undefined) out.add(String(ORDINALS[token]));
    }
  }

  return out;
}

function trimNumber(value: string): string {
  if (!value.includes('.')) return String(Number(value));
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? String(asNumber) : value;
}

/**
 * Numbers asserted by `claim` that `source` never said.
 *
 * A claimed number counts as supported if it appears in the source set directly, or as a
 * substring of a longer spoken run (a callee saying "4471" supports a claim of "447" only
 * when the claim is itself a run of the same digits — so containment is checked in the
 * direction that cannot manufacture support).
 */
export function unsupportedNumbers(claim: string, source: string): string[] {
  const claimed = numbersIn(claim);
  const said = numbersIn(source);
  const saidJoined = [...said];
  return [...claimed].filter((value) => {
    if (said.has(value)) return false;
    // A claim of "12" is supported by a spoken "twelfth" or by "1240" only if the digits
    // appear contiguously in something actually said.
    return !saidJoined.some((spoken) => spoken.length > value.length && spoken.includes(value));
  });
}
