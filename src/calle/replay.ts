import type {
  CallEvent,
  CallRecord,
  CalleTransport,
  CreateCallRequest,
} from './types.ts';
import { Recorder } from './recorder.ts';
import { scenarioKey } from './live.ts';

/**
 * Replay transport: reads recorded artifacts instead of dialling.
 *
 * This is the default mode and the path judges run. It needs no API key, no Twilio number,
 * and places no calls, while reproducing the real timeline — each getCall() advances one
 * recorded poll, so a replayed chase shows the same progression a live one did, including
 * the minutes spent on hold.
 */
export class ReplayCalle implements CalleTransport {
  readonly mode = 'replay' as const;

  private readonly recorder: Recorder;
  /** callId -> { scenario, cursor } */
  private readonly cursors = new Map<string, { scenario: string; at: number }>();

  constructor(opts: { artifactsRoot: string }) {
    this.recorder = new Recorder(opts.artifactsRoot);
  }

  async createCall(req: CreateCallRequest, _idempotencyKey: string): Promise<CallRecord> {
    const scenario = scenarioKey(req);
    const steps = await this.recorder.steps(scenario);
    const create = steps.find((s) => s.kind === 'create');
    if (!create) {
      throw new Error(
        `No recorded artifact for scenario "${scenario}". Record it once with ` +
          `KOL_MODE=live, or pick a scenario listed in artifacts/index.json.`,
      );
    }
    const call = create.payload as CallRecord;
    const callId = String(call.call_id ?? scenario);
    this.cursors.set(callId, { scenario, at: 0 });
    return call;
  }

  async getCall(callId: string): Promise<CallRecord> {
    const cursor = this.cursors.get(callId);
    if (!cursor) throw new Error(`Unknown call ${callId} in replay mode. Create it first.`);
    const polls = (await this.recorder.steps(cursor.scenario)).filter((s) => s.kind === 'poll');
    if (polls.length === 0) {
      // Some recordings only captured the terminal create response.
      const steps = await this.recorder.steps(cursor.scenario);
      const create = steps.find((s) => s.kind === 'create');
      return (create?.payload ?? {}) as CallRecord;
    }
    const at = Math.min(cursor.at, polls.length - 1);
    cursor.at = at + 1;
    return polls[at]!.payload as CallRecord;
  }

  async getEvents(callId: string): Promise<CallEvent[]> {
    const cursor = this.cursors.get(callId);
    if (!cursor) return [];
    const steps = await this.recorder.steps(cursor.scenario);
    const events = steps.find((s) => s.kind === 'events');
    return (events?.payload ?? []) as CallEvent[];
  }
}
