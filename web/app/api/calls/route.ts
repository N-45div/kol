import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRun, start } from 'workflow/api';
import { callingEnabled, getCall, publicCallState, validateDestination, verifyPin } from '@/lib/calle';
import type { DemoScenario } from '@/lib/live-evidence';
import { chaseWorkflow, type ChaseProgress } from '@/workflows/chase';

export const runtime = 'nodejs';

/** What the browser sees of a durable run. Nothing here is trusted over the CALL-E receipt. */
interface RunView {
  runId: string;
  runKey: string;
  runStatus: string;
  callId: string | null;
  output: unknown | null;
}

export async function POST(request: NextRequest) {
  try {
    if (!callingEnabled()) return NextResponse.json({ error: 'Live calling is disabled on this deployment.' }, { status: 503 });
    const body = await request.json() as { phone?: string; pin?: string; confirmed?: boolean; scenario?: string };
    if (!verifyPin(String(body.pin ?? ''))) return NextResponse.json({ error: 'Incorrect demo PIN.' }, { status: 401 });
    if (body.confirmed !== true) return NextResponse.json({ error: 'Exact call authorisation is required.' }, { status: 400 });
    const destination = validateDestination(String(body.phone ?? ''));
    const scenario: DemoScenario = body.scenario === 'claim_evidence' || body.scenario === 'ivr_route' ? body.scenario : 'reachability';
    // The chase is a durable run from here on. The call itself is created inside it, exactly once.
    const runKey = randomUUID();
    const run = await start(chaseWorkflow, [{ destination, scenario, runKey }]);
    const view: RunView = { runId: run.runId, runKey, runStatus: 'pending', callId: null, output: null };
    return NextResponse.json(view, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Call request failed.' }, { status: 400 });
  }
}

/**
 * The run's own view of itself: its status, the call it created (announced on the run's
 * stream as soon as the create step commits), and its return value once it has finished.
 */
async function runView(runId: string, runKey: string): Promise<RunView> {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(runId)) throw new Error('Invalid run id.');
  const run = getRun<typeof chaseWorkflow>(runId);
  if (!(await run.exists)) throw new Error('Unknown run.');
  const runStatus = String(await run.status);
  const callId = await firstAnnouncedCallId(run.getReadable<ChaseProgress>());
  const output = runStatus === 'completed' ? await run.returnValue : null;
  return { runId, runKey, runStatus, callId, output };
}

/** The create step announces the call id as the first chunk. Wait briefly for it, never long. */
async function firstAnnouncedCallId(readable: ReadableStream<ChaseProgress>): Promise<string | null> {
  const reader = readable.getReader();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
  try {
    const first = await Promise.race([reader.read().then((r) => (r.done ? null : r.value)), timeout]);
    return first?.kind === 'call_created' ? first.callId : null;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyPin(request.headers.get('x-kol-demo-pin') ?? '')) return NextResponse.json({ error: 'Incorrect demo PIN.' }, { status: 401 });
    const runId = request.nextUrl.searchParams.get('run');
    if (runId) return NextResponse.json(await runView(runId, request.nextUrl.searchParams.get('key') ?? ''));
    const callId = request.nextUrl.searchParams.get('id') ?? '';
    return NextResponse.json(publicCallState(await getCall(callId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status request failed.' }, { status: 400 });
  }
}
