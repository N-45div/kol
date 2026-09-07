import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { maskDeep } from '../util/mask.ts';

/**
 * Every live call is expensive and unrepeatable, so every response is written to disk the
 * moment it arrives. The recording is not a debug convenience: it IS the zero-call path the
 * hackathon rules require judges to be able to run, and it is what the replay transport
 * reads back.
 *
 * Layout:
 *   artifacts/index.json            scenario -> { call_id, steps }
 *   artifacts/<scenario>/00-request.json
 *   artifacts/<scenario>/01-create.json
 *   artifacts/<scenario>/02-poll.json ... NN-poll.json
 *   artifacts/<scenario>/events.json
 *
 * Everything is masked on the way in. An artifact is committed to git, so it must never
 * hold a real number or a token.
 */

export interface IndexEntry {
  call_id: string;
  created_at: string;
  steps: number;
  note?: string;
}

export type ArtifactIndex = Record<string, IndexEntry>;

export class Recorder {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private indexPath(): string {
    return join(this.root, 'index.json');
  }

  private dir(scenario: string): string {
    return join(this.root, scenario);
  }

  async readIndex(): Promise<ArtifactIndex> {
    if (!existsSync(this.indexPath())) return {};
    return JSON.parse(await readFile(this.indexPath(), 'utf8')) as ArtifactIndex;
  }

  private async writeIndex(index: ArtifactIndex): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify(index, null, 2) + '\n', 'utf8');
  }

  /** Next free step number for a scenario, so a resumed run appends rather than overwrites. */
  private async nextStep(scenario: string): Promise<number> {
    const index = await this.readIndex();
    return index[scenario]?.steps ?? 0;
  }

  async record(scenario: string, kind: string, payload: unknown, callId?: string): Promise<void> {
    const step = await this.nextStep(scenario);
    await mkdir(this.dir(scenario), { recursive: true });
    const name = `${String(step).padStart(2, '0')}-${kind}.json`;
    await writeFile(
      join(this.dir(scenario), name),
      JSON.stringify(maskDeep(payload), null, 2) + '\n',
      'utf8',
    );
    const index = await this.readIndex();
    const prev = index[scenario];
    index[scenario] = {
      call_id: callId ?? prev?.call_id ?? '',
      created_at: prev?.created_at ?? new Date().toISOString(),
      steps: step + 1,
      ...(prev?.note ? { note: prev.note } : {}),
    };
    await this.writeIndex(index);
  }

  /** Read back every recorded step of a scenario, in order. */
  async steps(scenario: string): Promise<{ kind: string; payload: unknown }[]> {
    const index = await this.readIndex();
    const entry = index[scenario];
    if (!entry) return [];
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(this.dir(scenario))).filter((f) => f.endsWith('.json')).sort();
    const out: { kind: string; payload: unknown }[] = [];
    for (const f of files) {
      const kind = f.replace(/^\d+-/, '').replace(/\.json$/, '');
      out.push({ kind, payload: JSON.parse(await readFile(join(this.dir(scenario), f), 'utf8')) });
    }
    return out;
  }
}
