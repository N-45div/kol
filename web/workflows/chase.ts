import { createHook, getWritable, sleep, FatalError } from 'workflow';
import { createDemoCall, getCall, publicCallState } from '@/lib/calle';
import { applyRouteReceipt, type DemoScenario, type PublicCallState } from '@/lib/live-evidence';

/**
 * One chase as a durable run.
 *
 * A payer call is a long process with a human at the end of it: the call rings, holds, ends;
 * the transcript lands; then the person who answered tells Kol which keypad tones they heard.
 * That last part can take a minute or a day. None of it should depend on a browser tab
 * staying open or a serverless function staying alive, and none of it may ever dial twice.
 *
 * So the chase is a Workflow run. Each step is checkpointed: the call is created exactly once
 * under an idempotency key derived from the run, polling survives restarts, and the run then
 * suspends on a hook until the operator's receipt arrives. The final receipt is the run's
 * return value.
 */

export interface ChaseInput {
  destination: string;
  scenario: DemoScenario;
  /** Unique per submission. Names the idempotency key and the receipt hook. */
  runKey: string;
}

export interface ChaseProgress {
  kind: 'call_created';
  callId: string;
}

export interface ReceiptPayload {
  /** The tones the operator heard, or null to decline to attest. */
  heardKeys: string | null;
}

export async function chaseWorkflow(input: ChaseInput): Promise<PublicCallState> {
  'use workflow';

  const { callId } = await createCall(input);

  let state = await pollCall(callId);
  for (let poll = 0; !state.terminal && poll < 120; poll++) {
    await sleep('6s');
    state = await pollCall(callId);
  }

  if (state.scenario === 'ivr_route' && state.terminal && state.status === 'completed') {
    // Suspend, durably, until the person who answered says what they heard.
    using receipt = createHook<ReceiptPayload>({ token: hookToken(input.runKey) });
    const payload = await receipt;
    if (payload.heardKeys !== null) state = await attachReceipt(state, payload.heardKeys);
  }

  return state;
}

export function hookToken(runKey: string): string {
  return `receipt:${runKey}`;
}

/** Create the CALL-E call exactly once. Never retried: an ambiguous outcome is a person's call. */
async function createCall(input: ChaseInput): Promise<{ callId: string }> {
  'use step';
  let call;
  try {
    call = await createDemoCall(input.destination, input.scenario, `kol-run-${input.runKey}`);
  } catch (error) {
    throw new FatalError(error instanceof Error ? error.message : 'CALL-E rejected the call.');
  }
  const callId = String(call.id ?? call.call_id ?? '');
  if (!callId) throw new FatalError('CALL-E accepted the request but returned no call id.');

  // Tell whoever is watching which call this run owns, so they can follow the live transcript.
  const writer = getWritable<ChaseProgress>().getWriter();
  await writer.write({ kind: 'call_created', callId });
  writer.releaseLock();
  return { callId };
}
createCall.maxRetries = 0;

async function pollCall(callId: string): Promise<PublicCallState> {
  'use step';
  return publicCallState(await getCall(callId));
}

async function attachReceipt(state: PublicCallState, heardKeys: string): Promise<PublicCallState> {
  'use step';
  return applyRouteReceipt(state, heardKeys);
}
