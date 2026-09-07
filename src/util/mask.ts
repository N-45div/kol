/**
 * Phone masking. The awesome-phone-call-agents contribution checklist requires masked
 * numbers in every sample, and the rules require we ship no personal data. Masking happens
 * at the edge: anything written to disk, logged, or rendered goes through here.
 */

const E164 = /\+\d{6,15}/g;

/** +919876543210 -> +91•••••••210 : country hint and last 3, nothing else. */
export function maskE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+') || digits.length < 8) return '+' + '•'.repeat(8);
  const cc = digits.slice(0, 3);
  const tail = digits.slice(-3);
  const hidden = Math.max(4, digits.length - cc.length - tail.length);
  return `${cc}${'•'.repeat(hidden)}${tail}`;
}

/** Mask every E.164-looking run inside arbitrary text, e.g. a transcript. */
export function maskText(text: string): string {
  return text.replace(E164, (m) => maskE164(m));
}

/** Deep-mask a payload before it is logged or written to a committed artifact. */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskDeep(v);
    }
    return out as T;
  }
  return value;
}
