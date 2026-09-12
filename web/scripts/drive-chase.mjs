// Drives one durable chase through the running dev server: start the run, follow it until it
// knows its call, follow the call to terminal, attach the operator receipt, and read the run's
// verdict. Exits non-zero unless the run finished verified with exactly one call created.
const base = process.env.KOL_WEB ?? 'http://127.0.0.1:3077';
const fake = process.env.KOL_CALLE_ORIGIN ?? 'http://127.0.0.1:4777';
const pin = process.env.KOL_DEMO_PIN ?? '1234';
const phone = process.env.KOL_ALLOWED_DESTINATIONS ?? '+15550001111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, init) => { const r = await fetch(url, init); const j = await r.json(); if (!r.ok) throw new Error(`${url}: ${r.status} ${JSON.stringify(j)}`); return j; };

const started = await json(`${base}/api/calls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, pin, confirmed: true, scenario: 'ivr_route' }) });
console.log('started run', started.runId, started.runStatus);

let run = started;
for (let i = 0; i < 40 && !run.callId; i++) { await sleep(1500); run = await json(`${base}/api/calls?run=${run.runId}&key=${run.runKey}`, { headers: { 'x-kol-demo-pin': pin } }); }
if (!run.callId) throw new Error('the run never announced a call id');
console.log('run announced call', run.callId, '| run status', run.runStatus);

let call;
for (let i = 0; i < 60; i++) { call = await json(`${base}/api/calls?id=${run.callId}`, { headers: { 'x-kol-demo-pin': pin } }); if (call.terminal) break; await sleep(2000); }
console.log('call terminal:', call.status, '| verdict before receipt:', call.verdict, '| reported route:', call.reportedRoute?.join(','));
if (call.verdict !== 'needs_review') throw new Error('expected needs_review while the model is the only witness');

// The run should now be suspended on the receipt hook. Give the hook a moment to register.
let resumed;
for (let i = 0; i < 20; i++) {
  try { resumed = await json(`${base}/api/calls/receipt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runKey: run.runKey, pin, heardKeys: '2 1' }) }); break; }
  catch (error) { await sleep(1500); if (i === 19) throw error; }
}
console.log('receipt accepted by run', resumed.runId);

for (let i = 0; i < 40 && run.runStatus !== 'completed'; i++) { await sleep(1500); run = await json(`${base}/api/calls?run=${run.runId}&key=${run.runKey}`, { headers: { 'x-kol-demo-pin': pin } }); }
console.log('run status', run.runStatus, '| final verdict', run.output?.verdict, '| receipt', run.output?.routeReceipt?.keys?.join(','));

const creates = await json(`${fake}/__creates`);
console.log('CALL-E create requests seen by the fake:', creates.length, creates);
if (run.runStatus !== 'completed' || run.output?.verdict !== 'verified' || creates.length !== 1) { console.error('E2E FAILED'); process.exit(1); }
console.log('E2E OK: one call, durable run, operator receipt, verified.');
