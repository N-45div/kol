import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fingerprintSteps } from './fingerprint.ts';
import { detectDrift, type DriftReport } from './drift.ts';
import { type NavigationReport, type Route, type RouteStep, routeKey } from './types.ts';

/**
 * Durable Route Atlas. Plain JSON on disk — the atlas is meant to be read, diffed in a pull
 * request, and argued with. An opaque database would hide exactly the thing an operator needs
 * to see: what we believe about a phone tree, and how confident we are.
 *
 * Timestamps are injected rather than read from the clock so the store is deterministic under
 * test and under artifact replay.
 */

export interface AtlasFile {
  version: 1;
  routes: Record<string, Route>;
}

const EMPTY: AtlasFile = { version: 1, routes: {} };

export class Atlas {
  private readonly path: string;
  private data: AtlasFile = EMPTY;
  private loaded = false;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    if (existsSync(this.path)) {
      this.data = JSON.parse(await readFile(this.path, 'utf8')) as AtlasFile;
    } else {
      this.data = { version: 1, routes: {} };
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }

  get(lineE164: string, goal: string): Route | undefined {
    return this.data.routes[routeKey(lineE164, goal)];
  }

  all(): Route[] {
    return Object.values(this.data.routes);
  }

  /**
   * Fold one call's navigation report into the atlas.
   *
   * Four outcomes, and keeping them apart is the whole point:
   *   learned    — first time down this line, we now have a route
   *   confirmed  — the route held; confidence goes up
   *   repaired   — the tree moved, we re-explored on the same call, route replaced
   *   quarantined — something happened we cannot read; the route stops being replayable
   *                 rather than being trusted on a guess
   */
  async record(opts: {
    lineE164: string;
    org: string;
    goal: string;
    targetName: string;
    report: NavigationReport;
    now: string;
    holdSeconds?: number;
  }): Promise<{ outcome: 'learned' | 'confirmed' | 'repaired' | 'quarantined'; route?: Route; drift?: DriftReport }> {
    await this.load();
    const key = routeKey(opts.lineE164, opts.goal);
    const existing = this.data.routes[key];
    const steps = toSteps(opts.report);

    if (!existing) {
      if (opts.report.reached_target !== 'yes' || steps.length === 0) {
        return { outcome: 'quarantined' };
      }
      const route: Route = {
        lineE164: opts.lineE164,
        org: opts.org,
        goal: opts.goal,
        targetName: opts.report.target_name_used || opts.targetName,
        steps,
        fingerprint: fingerprintSteps(steps),
        version: 1,
        status: 'fresh',
        firstObservedAt: opts.now,
        lastVerifiedAt: opts.now,
        confirmations: 1,
        corrections: 0,
        ...(opts.holdSeconds !== undefined
          ? { hold: { samples: 1, p50Seconds: opts.holdSeconds, p90Seconds: opts.holdSeconds } }
          : {}),
      };
      this.data.routes[key] = route;
      await this.save();
      return { outcome: 'learned', route };
    }

    const drift = detectDrift(existing, opts.report);

    if (drift.kind === 'unreadable' || opts.report.reached_target === 'unclear') {
      existing.status = 'stale';
      existing.lastVerifiedAt = opts.now;
      this.data.routes[key] = existing;
      await this.save();
      return { outcome: 'quarantined', route: existing, drift };
    }

    if (drift.kind === 'none') {
      existing.confirmations += 1;
      existing.status = 'fresh';
      existing.lastVerifiedAt = opts.now;
      if (opts.holdSeconds !== undefined) existing.hold = mergeHold(existing.hold, opts.holdSeconds);
      this.data.routes[key] = existing;
      await this.save();
      return { outcome: 'confirmed', route: existing, drift };
    }

    // The tree moved. If the call recovered on its own, adopt what it heard; if it did not,
    // mark the route stale so the next run explores instead of walking the old path again.
    if (opts.report.reached_target === 'yes' && steps.length > 0) {
      const repaired: Route = {
        ...existing,
        targetName: opts.report.target_name_used || existing.targetName,
        steps,
        fingerprint: fingerprintSteps(steps),
        version: existing.version + 1,
        status: 'fresh',
        lastVerifiedAt: opts.now,
        confirmations: 1,
        corrections: existing.corrections + 1,
        ...(opts.holdSeconds !== undefined ? { hold: mergeHold(existing.hold, opts.holdSeconds) } : {}),
      };
      this.data.routes[key] = repaired;
      await this.save();
      return { outcome: 'repaired', route: repaired, drift };
    }

    existing.status = 'stale';
    existing.corrections += 1;
    existing.lastVerifiedAt = opts.now;
    this.data.routes[key] = existing;
    await this.save();
    return { outcome: 'quarantined', route: existing, drift };
  }
}

function toSteps(report: NavigationReport): RouteStep[] {
  return (report.menu_levels ?? [])
    .filter((l) => l.action_type === 'dtmf' || l.action_type === 'speech')
    .map((l) => ({
      level: l.level,
      heard: l.prompt_heard,
      ...(l.options_offered ? { optionsOffered: l.options_offered } : {}),
      action: { type: l.action_type, value: l.action_value ?? '' },
    }))
    .sort((a, b) => a.level - b.level);
}

function mergeHold(
  prev: Route['hold'],
  seconds: number,
): NonNullable<Route['hold']> {
  if (!prev) return { samples: 1, p50Seconds: seconds, p90Seconds: seconds };
  const samples = prev.samples + 1;
  // Running approximations: good enough to set an expectation in the prose, and honest about
  // being estimates rather than a real percentile over retained samples.
  return {
    samples,
    p50Seconds: Math.round(prev.p50Seconds + (seconds - prev.p50Seconds) / samples),
    p90Seconds: Math.max(prev.p90Seconds, seconds),
  };
}
