import type { CalleTransport } from './types.ts';
import { LiveCalle } from './live.ts';
import { ReplayCalle } from './replay.ts';

export * from './types.ts';
export { LiveCalle } from './live.ts';
export { ReplayCalle } from './replay.ts';
export { Recorder } from './recorder.ts';

/**
 * Replay is the default. Placing real calls must be a deliberate act — KOL_MODE=live —
 * never something that happens because an env var was missing.
 */
export function createTransport(env: NodeJS.ProcessEnv = process.env): CalleTransport {
  const artifactsRoot = env['KOL_ARTIFACTS'] ?? './artifacts';
  if (env['KOL_MODE'] === 'live') {
    return new LiveCalle({
      apiKey: env['CALLE_API_KEY'] ?? '',
      baseUrl: env['CALLE_BASE_URL'],
      artifactsRoot,
    });
  }
  return new ReplayCalle({ artifactsRoot });
}
