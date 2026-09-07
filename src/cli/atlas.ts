import { Atlas } from '../atlas/store.ts';
import { extractOptions } from '../atlas/fingerprint.ts';
import { maskE164 } from '../util/mask.ts';

/**
 * Show what Kol believes about every line it has called.
 *
 *   npm run atlas
 *
 * The atlas is meant to be read and argued with, so this prints the tree, which branch the
 * stored route takes, how much trust it has earned, and when it was last confirmed.
 */

const atlas = new Atlas(process.env['KOL_ATLAS'] ?? './atlas/routes.json');
await atlas.load();
const routes = atlas.all();

if (routes.length === 0) {
  console.log('\n  The atlas is empty. Run a chase to learn a route.\n');
} else {
  console.log('');
  for (const route of routes) {
    const age = route.lastVerifiedAt.replace('T', ' ').slice(0, 16);
    const trust = route.status === 'fresh'
      ? `${route.confirmations} confirmation${route.confirmations === 1 ? '' : 's'}`
      : route.status.toUpperCase();

    console.log(`  ${route.org}  ${maskE164(route.lineE164)}   goal: ${route.goal}`);
    console.log(`    v${route.version} · ${trust} · ${route.corrections} correction${route.corrections === 1 ? '' : 's'} · last confirmed ${age}`);
    if (route.hold) {
      console.log(`    hold: ~${Math.round(route.hold.p50Seconds)}s typical, ${Math.round(route.hold.p90Seconds)}s worst of ${route.hold.samples}`);
    }
    console.log('');

    for (const step of route.steps) {
      const options = extractOptions(step.heard);
      const chosen = step.action.value;
      console.log(`    level ${step.level}`);
      if (options.length > 0) {
        for (const option of options) {
          const taken = option.digit === chosen;
          console.log(`      ${taken ? '>' : ' '} ${option.digit}  ${option.label}${taken ? '   <- our route' : ''}`);
        }
      } else {
        console.log(`        (menu not parsed) ${step.heard.slice(0, 60)}...`);
        console.log(`      > ${step.action.type} ${chosen}   <- our route`);
      }
      console.log('');
    }
    console.log(`    fingerprint ${route.fingerprint}`);
    console.log('');
  }
}
