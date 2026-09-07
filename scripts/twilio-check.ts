/**
 * What can this Twilio account actually do?
 *
 * Read-only. Buys nothing, changes nothing. Answers the four questions that decide whether
 * Twilio can host the IVR fixture:
 *
 *   1. Is the account trial or upgraded, and what is the balance?
 *   2. Does it already own a number, and is that number voice-capable?
 *   3. Can it search US local numbers? (Trial accounts outside the US usually cannot.)
 *   4. Which countries are available to it at all?
 *
 * Put credentials in .env, never in a chat window:
 *   TWILIO_ACCOUNT_SID=ACxxxxxxxx
 *   TWILIO_AUTH_TOKEN=xxxxxxxx
 *
 * Run:  node --env-file=.env scripts/twilio-check.ts
 */

const SID = process.env['TWILIO_ACCOUNT_SID'] ?? '';
const TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? '';
const BASE = 'https://api.twilio.com/2010-04-01';

if (!SID || !TOKEN) {
  console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env first.');
  console.error('Find both at https://console.twilio.com (Account Info panel).');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

async function get(path: string): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: auth } });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* leave as text */
  }
  return { ok: res.ok, status: res.status, body };
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

const account = await get(`/Accounts/${SID}.json`);
if (!account.ok) {
  console.error(`\nCredentials rejected (HTTP ${account.status}).`);
  console.error(typeof account.body === 'object' ? account.body.message : account.body);
  process.exit(1);
}

console.log('\n=== Account ===');
line('friendly name', account.body.friendly_name ?? '(none)');
line('type', account.body.type ?? '(unknown)');
line('status', account.body.status ?? '(unknown)');

const balance = await get(`/Accounts/${SID}/Balance.json`);
if (balance.ok) line('balance', `${balance.body.balance} ${balance.body.currency}`);

const isTrial = String(account.body.type).toLowerCase() === 'trial';

console.log('\n=== Numbers already owned ===');
const owned = await get(`/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=20`);
const list: any[] = owned.ok ? (owned.body.incoming_phone_numbers ?? []) : [];
if (list.length === 0) {
  console.log('  (none)');
} else {
  for (const n of list) {
    const caps = n.capabilities ?? {};
    console.log(`  ${n.phone_number}   ${caps.voice ? 'VOICE' : 'no-voice'}${caps.sms ? ' +sms' : ''}`);
    line('  friendly name', n.friendly_name ?? '');
    line('  voice url', n.voice_url || '(not configured)');
    line('  voice app sid', n.voice_application_sid || '(none)');
    line('  sid', n.sid);
  }
}

console.log('\n=== Can we buy a US local number? ===');
const us = await get(`/Accounts/${SID}/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&PageSize=3`);
if (us.ok) {
  const avail: any[] = us.body.available_phone_numbers ?? [];
  if (avail.length > 0) {
    console.log('  YES — search returned candidates:');
    for (const a of avail) console.log(`    ${a.phone_number}  ${a.locality ?? ''} ${a.region ?? ''}`);
  } else {
    console.log('  Search succeeded but returned no numbers.');
  }
} else {
  console.log(`  NO — HTTP ${us.status}: ${typeof us.body === 'object' ? us.body.message : us.body}`);
}

console.log('\n=== Countries available to this account ===');
const countries = await get(`/Accounts/${SID}/AvailablePhoneNumbers.json`);
if (countries.ok) {
  const cs: any[] = countries.body.countries ?? [];
  console.log('  ' + (cs.length ? cs.map((c) => c.country_code).join(', ') : '(none)'));
} else {
  console.log(`  HTTP ${countries.status}`);
}

console.log('\n=== Verdict ===');
const voiceNumber = list.find((n) => n.capabilities?.voice);
if (voiceNumber) {
  console.log(`  Usable fixture line already owned: ${voiceNumber.phone_number}`);
  console.log('  Next: point it at a TwiML Bin and set KOL_FIXTURE_LINE in .env.');
  if (isTrial) {
    console.log('  Note: trial. Inbound to this number should work; confirm by dialling it');
    console.log('  yourself once and listening for a trial notice before the menu.');
  }
} else if (us.ok) {
  console.log('  No number yet, but US local search works — one can be provisioned.');
} else {
  console.log('  No voice number and US search is blocked. Use the laptop fixture instead,');
  console.log('  or upgrade. See fixtures/laptop/README.md.');
}
console.log('');
