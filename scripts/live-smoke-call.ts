import { createHash } from 'node:crypto';

import { LiveCalle, callIdOf } from '../src/calle/live.ts';
import { pollUntilTerminal } from '../src/calle/poll.ts';
import { allTurns } from '../src/calle/types.ts';
import { maskE164 } from '../src/util/mask.ts';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const to = flag('to')?.replace(/[\s()-]/g, '') ?? '';
const authorised = flag('authorise')?.replace(/[\s()-]/g, '') ?? '';

if (!/^\+91\d{10}$/.test(to) || to !== authorised) {
  throw new Error('Provide the same Indian E.164 number through --to and --authorise. No call was placed.');
}

const transport = new LiveCalle({
  apiKey: process.env.CALLE_API_KEY ?? '',
  baseUrl: process.env.CALLE_BASE_URL,
  artifactsRoot: process.env.KOL_ARTIFACTS ?? './artifacts',
});
const scenario = `smoke-india-${new Date().toISOString().slice(0, 10)}`;
const request = {
  task: [
    'Place one brief product smoke-test call.',
    'Begin by saying: Hello, this is an automated test call from Kol. This call contains no medical information.',
    'Ask the recipient to say exactly: Kol test received.',
    'Record whether the exact phrase was heard, thank the recipient, and end the call.',
    'Do not ask for a name, identity, health information, payment, or any other personal data.',
  ].join(' '),
  recipients: [{ phones: [to], region: 'IN', locale: 'en-IN' }],
  result_schema: {
    type: 'object',
    required: ['test_phrase_heard', 'exact_phrase'],
    properties: {
      test_phrase_heard: { type: 'boolean' },
      exact_phrase: { type: 'string', description: 'Exact recipient words, or an empty string.' },
    },
  },
  metadata: { kol_scenario: scenario, purpose: 'authorised_product_smoke_test' },
};
const idempotencyKey = `kol-smoke-${createHash('sha256').update(`${to}:${scenario}`).digest('hex').slice(0, 32)}`;

console.log(`Submitting one authorised test call to ${maskE164(to)}.`);
const created = await transport.createCall(request, idempotencyKey);
const callId = callIdOf(created);
if (!callId) throw new Error('CALL-E returned no call id. Do not retry until the dashboard is checked.');
console.log(`CALL-E accepted ${callId}. Waiting for a terminal result...`);
const final = await pollUntilTerminal(transport, callId, {
  firstDelayMs: 15_000,
  intervalMs: 6_000,
  onProgress: (call, elapsed) => console.log(`${Math.round(elapsed / 1000)}s ${call.status ?? 'unknown'}`),
});
const recipient = final.recipients?.[0];
const structured = final.structured_result ?? recipient?.structured_result ?? {};
console.log(`Final status: ${final.status ?? recipient?.status ?? 'unknown'}`);
console.log(`Phrase heard: ${structured.test_phrase_heard === true ? 'yes' : 'no or unsupported'}`);
console.log(`Transcript turns captured: ${allTurns(final).length}`);
