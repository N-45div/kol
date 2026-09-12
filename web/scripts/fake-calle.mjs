// A stand-in for api.heycall-e.com so the durable chase can be exercised end to end with no
// call placed and no credentials. It accepts one call, reports it queued twice, then completes
// it with a transcript in which the recipient read both menus and answered as the rep.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_CALLE_PORT ?? 4777);
const calls = new Map();
const creates = [];

const MENU_1 = 'Thank you for calling Fixture Health Plan. For member eligibility, press 1. For claims, press 2. For provider services, press 3.';
const MENU_2 = 'Claims. For the status of an existing claim, press 1. To file a new claim, press 2.';

function completed(id, metadata) {
  return {
    id,
    object: 'call_task',
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.91, label: 'high' },
    metadata,
    structured_result: {
      reached_target: 'yes',
      target_name_used: 'claims status department',
      menu_levels: [
        { level: 1, prompt_heard: MENU_1, action_type: 'dtmf', action_value: '2' },
        { level: 2, prompt_heard: MENU_2, action_type: 'dtmf', action_value: '1' },
      ],
      claim_reference: '4471',
      claim_status: 'paid',
      paid_amount: '$1,240',
      payment_date: 'August 12, 2026',
    },
    recipients: [{ status: 'completed', attempts: [{ transcript_turns: [
      { offset_seconds: 0, speaker: 'bot', text: 'Hello, this is Kol, an automated assistant running a fictional phone-menu demonstration.' },
      { offset_seconds: 5, speaker: 'user', text: MENU_1 },
      { offset_seconds: 16, speaker: 'user', text: MENU_2 },
      { offset_seconds: 24, speaker: 'user', text: 'This is the claims status department.' },
      { offset_seconds: 28, speaker: 'bot', text: 'What is the current status of fictional claim 4471?' },
      { offset_seconds: 33, speaker: 'user', text: 'Claim 4471 was paid $1,240 on August 12, 2026.' },
    ] }] }],
  };
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'POST' && req.url === '/v1/calls') {
      const key = req.headers['idempotency-key'];
      creates.push(key);
      const existing = [...calls.values()].find((c) => c.key === key);
      if (existing) return send(200, { id: existing.id, object: 'call_task', status: 'queued' });
      const id = `call_fake_${calls.size + 1}_${Math.random().toString(36).slice(2, 10)}`;
      calls.set(id, { id, key, polls: 0, metadata: JSON.parse(body).metadata });
      return send(200, { id, object: 'call_task', status: 'queued' });
    }
    if (req.method === 'GET' && req.url === '/__creates') return send(200, creates);
    const m = /^\/v1\/calls\/([^/?]+)$/.exec(req.url ?? '');
    if (req.method === 'GET' && m) {
      const call = calls.get(m[1]);
      if (!call) return send(404, { error: 'not found' });
      call.polls += 1;
      if (call.polls < 3) return send(200, { id: call.id, object: 'call_task', status: 'in_progress', metadata: call.metadata, recipients: [] });
      return send(200, completed(call.id, call.metadata));
    }
    send(404, { error: 'unknown route' });
  });
}).listen(port, '127.0.0.1', () => console.log(`fake CALL-E on http://127.0.0.1:${port}`));
