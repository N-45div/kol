// Start a chase, then kill the dev server while the run is mid-poll and bring it back.
// The run must finish with exactly one CALL-E create. Local World keeps its queue in memory,
// so this exercises the durability the Vercel World gives for free: the run resumes from its
// last committed step instead of starting over.
import { spawn, spawnSync } from 'node:child_process';
const base = 'http://127.0.0.1:3077';
const fake = 'http://127.0.0.1:4777';
const pin = '1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, init) => { const r = await fetch(url, init); const j = await r.json(); if (!r.ok) throw new Error(`${url}: ${r.status} ${JSON.stringify(j)}`); return j; };
const env = { ...process.env, KOL_CALLING_ENABLED: 'true', CALLE_API_KEY: 'fake-key', KOL_DEMO_PIN: pin, KOL_ALLOWED_DESTINATIONS: '+15550001111', KOL_CALLE_ORIGIN: fake, WORKFLOW_LOCAL_DATA_DIR: '.next/workflow-data' };
const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/call`)).ok) return; } catch {} await sleep(2000); } throw new Error('dev server not up'); };
const boot = () => spawn('npx', ['next', 'dev', '-p', '3077'], { env, shell: true, stdio: 'ignore', detached: process.platform !== 'win32' });
// Windows has no process groups: kill the whole tree by pid.
const stop = (child) => process.platform === 'win32' ? spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) : process.kill(-child.pid);

const before = (await json(`${fake}/__creates`)).length;
let dev = boot(); await up();
const started = await json(`${base}/api/calls`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '+15550001111', pin, confirmed: true, scenario: 'ivr_route' }) });
let run = started;
for (let i = 0; i < 40 && !run.callId; i++) { await sleep(1500); run = await json(`${base}/api/calls?run=${run.runId}&key=${run.runKey}`, { headers: { 'x-kol-demo-pin': pin } }); }
console.log('run', run.runId, 'owns', run.callId, '— killing the server mid-poll');
stop(dev); await sleep(3000);
dev = boot(); await up();
console.log('server back; following the same run');
// The Local World keeps its queue in memory, so a restart drops the pending step. Re-enqueue
// it from the run's last checkpoint. The Vercel World's queue is durable and needs no nudge.
process.env.WORKFLOW_LOCAL_DATA_DIR = env.WORKFLOW_LOCAL_DATA_DIR;
process.env.WORKFLOW_LOCAL_BASE_URL = base;
const { getRun } = await import('workflow/api');
console.log('wakeUp:', JSON.stringify(await getRun(run.runId).wakeUp()));
for (let i = 0; i < 60; i++) { await sleep(2000); run = await json(`${base}/api/calls?run=${run.runId}&key=${run.runKey}`, { headers: { 'x-kol-demo-pin': pin } }); if (run.runStatus === 'completed' || run.runStatus === 'failed') break;
  try { await json(`${base}/api/calls/receipt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runKey: run.runKey, pin, heardKeys: '2 1' }) }); console.log('receipt attached after the restart'); } catch {} }
const creates = (await json(`${fake}/__creates`)).length - before;
console.log('run status', run.runStatus, '| verdict', run.output?.verdict, '| creates during this test', creates);
stop(dev);
if (run.runStatus !== 'completed' || run.output?.verdict !== 'verified' || creates !== 1) { console.error('KILL/RESUME FAILED'); process.exit(1); }
console.log('KILL/RESUME OK');
