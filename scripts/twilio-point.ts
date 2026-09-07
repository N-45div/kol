/**
 * Point the Twilio number at the fixture, or restore whatever it pointed at before.
 *
 *   node --env-file=.env scripts/twilio-point.ts --show
 *   node --env-file=.env scripts/twilio-point.ts --to https://xxxx.ngrok-free.app/voice
 *   node --env-file=.env scripts/twilio-point.ts --restore
 *
 * The first --to saves the number's existing voice URL to fixtures/ivr-sim/.previous-voice.json
 * so --restore can put it back (it was an ElevenLabs inbound webhook when we found it).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SID = process.env['TWILIO_ACCOUNT_SID'] ?? '';
const TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? '';
const LINE = process.env['KOL_FIXTURE_LINE'] ?? '';
const SAVE = 'fixtures/ivr-sim/.previous-voice.json';

if (!SID || !TOKEN || !LINE) {
  console.error('Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and KOL_FIXTURE_LINE in .env.');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
const base = `https://api.twilio.com/2010-04-01/Accounts/${SID}`;

async function findNumber(): Promise<any> {
  const res = await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(LINE)}`, {
    headers: { Authorization: auth },
  });
  const body: any = await res.json();
  const n = (body.incoming_phone_numbers ?? [])[0];
  if (!n) throw new Error(`Number ${LINE} not found on this account.`);
  return n;
}

async function update(numberSid: string, fields: Record<string, string>): Promise<any> {
  const res = await fetch(`${base}/IncomingPhoneNumbers/${numberSid}.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message ?? JSON.stringify(body)}`);
  return body;
}

// No process.exit() after a fetch: on Node 24 / Windows it trips a libuv assertion while the
// socket is still closing. Set exitCode and let the loop drain.
async function main(): Promise<number> {
  const [flag, value] = process.argv.slice(2);
  const n = await findNumber();

  if (flag === '--show' || !flag) {
    console.log(`${n.phone_number}`);
    console.log(`  voice_url        ${n.voice_url || '(none)'}`);
    console.log(`  voice_method     ${n.voice_method || '(none)'}`);
    console.log(`  status_callback  ${n.status_callback || '(none)'}`);
    return 0;
  }

  if (flag === '--to') {
    if (!value || !/^https:\/\//.test(value)) {
      console.error('--to needs an https URL, e.g. https://xxxx.ngrok-free.app/voice');
      return 1;
    }
    if (!existsSync(SAVE)) {
      writeFileSync(
        SAVE,
        JSON.stringify(
          { voice_url: n.voice_url, voice_method: n.voice_method, status_callback: n.status_callback, saved_at: new Date().toISOString() },
          null,
          2,
        ) + '\n',
      );
      console.log(`saved previous voice url to ${SAVE}`);
    }
    // StatusCallback is cleared too, so the previous integration stops receiving events
    // for calls it no longer handles.
    const updated = await update(n.sid, { VoiceUrl: value, VoiceMethod: 'POST', StatusCallback: '' });
    console.log(`${updated.phone_number} now -> ${updated.voice_url} (${updated.voice_method})`);
    return 0;
  }

  if (flag === '--restore') {
    if (!existsSync(SAVE)) {
      console.error(`Nothing saved at ${SAVE}; nothing to restore.`);
      return 1;
    }
    const prev = JSON.parse(readFileSync(SAVE, 'utf8'));
    const updated = await update(n.sid, {
      VoiceUrl: prev.voice_url ?? '',
      VoiceMethod: prev.voice_method ?? 'POST',
      StatusCallback: prev.status_callback ?? '',
    });
    console.log(`${updated.phone_number} restored -> ${updated.voice_url || '(none)'}`);
    return 0;
  }

  console.error('Usage: --show | --to <https url> | --restore');
  return 1;
}

process.exitCode = await main();
