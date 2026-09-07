/**
 * Fixture Health Plan — a two-level IVR served as TwiML, with server-side ground truth.
 *
 * Twilio dials our number, hits this server for instructions, and POSTs back every digit
 * the caller presses. Those POSTs are the point: they are logged with a timestamp and the
 * call SID, so we know exactly what CALL-E pressed from a source it cannot influence. The
 * leaf passphrases do the same job through the transcript. Two independent witnesses, no
 * reliance on the model's self-report.
 *
 * Zero dependencies. Run:
 *   node --env-file=.env fixtures/ivr-sim/server.ts            # variant A
 *   KOL_IVR_VARIANT=b node --env-file=.env fixtures/ivr-sim/server.ts
 *
 * Switch variant while running (the on-camera drift moment):
 *   curl -X POST http://127.0.0.1:3939/variant/b
 *
 * Ground truth for a call:
 *   curl http://127.0.0.1:3939/log            # JSONL, one event per Twilio request
 *
 * Twilio requests are verified with X-Twilio-Signature when TWILIO_AUTH_TOKEN is set, so a
 * public tunnel URL cannot be driven by anyone but Twilio. Set KOL_FIXTURE_VALIDATE=0
 * to disable while debugging.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env['KOL_IVR_PORT'] ?? 3939);
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? '';

/**
 * Which carrier fronts the number. TeXML (Telnyx) and LaML (SignalWire) are TwiML-compatible,
 * so the markup below serves all three; only request signing differs.
 *   twilio    HMAC-SHA1 over URL+params in X-Twilio-Signature (validated below)
 *   telnyx    Standard-Webhooks / ED25519 headers — captured and logged on the first request,
 *             validated once we have seen the real header set. Until then, allowed.
 *   none      no validation (local smoke tests only)
 */
type Provider = 'twilio' | 'telnyx' | 'none';
const PROVIDER = ((process.env['KOL_FIXTURE_PROVIDER'] ?? 'twilio') as Provider);
const VALIDATE =
  process.env['KOL_FIXTURE_VALIDATE'] !== '0' && PROVIDER === 'twilio' && AUTH_TOKEN.length > 0;

/** Headers worth learning from a new provider's first request. Values are never logged. */
const SIGNATURE_HEADER_HINTS = [
  'x-twilio-signature',
  'telnyx-signature-ed25519',
  'telnyx-timestamp',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
  'x-signalwire-signature',
  'user-agent',
];

let variant: 'a' | 'b' = process.env['KOL_IVR_VARIANT'] === 'b' ? 'b' : 'a';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(here, 'logs');
const LOG = join(LOG_DIR, 'calls.jsonl');
mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------------------
// Menu text. Identical to flow-a.json / flow-b.json so fingerprints in the test suite match.
// ---------------------------------------------------------------------------------------

const GREETING =
  'Thank you for calling Fixture Health Plan. This is a test line used for software testing. ' +
  'No real member information is held here.';

const MAIN_MENU = {
  a:
    'Please listen carefully, as our menu options have recently changed. ' +
    'For member eligibility, press 1. For claims, press 2. For provider services, press 3. ' +
    'To repeat this menu, press 9.',
  b:
    'Please listen carefully, as our menu options have recently changed. ' +
    'For claims, press 3. For member eligibility, press 1. For provider services, press 2. ' +
    'To repeat this menu, press 9.',
} as const;

/** Which digit leads where, per variant. */
const MAIN_ROUTES: Record<'a' | 'b', Record<string, string>> = {
  a: { '1': '/dept/eligibility', '2': '/menu2', '3': '/dept/provider', '9': '/voice' },
  b: { '1': '/dept/eligibility', '2': '/dept/provider', '3': '/menu2', '9': '/voice' },
};

const CLAIMS_DIGIT = { a: '2', b: '3' } as const;

const HOLD =
  'Thank you. Connecting you to a claims representative. Your call is important to us. ' +
  'Please continue to hold. Your estimated wait time is under two minutes.';
const HOLD_2 =
  'All of our representatives are currently assisting other callers. Please continue to ' +
  'hold. Thank you for your patience.';

const LEAF =
  'Claims department, this is Dana speaking. Let me look that up for you. Claim four four ' +
  'seven one was paid on August twelfth, in the amount of one thousand two hundred and forty ' +
  'dollars. Your confirmation reference is GREEN FALCON SEVEN. I repeat, GREEN FALCON SEVEN. ' +
  'Is there anything else I can help you with today?';

const DEPTS: Record<string, string> = {
  '/dept/eligibility':
    'Member eligibility. This department cannot help with claim status. Your reference for this department is BLUE OTTER TWO. Goodbye.',
  '/dept/provider':
    'Provider services. This department cannot help with claim status. Your reference for this department is RED MARLIN NINE. Goodbye.',
  '/dept/newclaim':
    'New claim intake. This is not claim status. Your reference for this department is GREY HERON FOUR. Goodbye.',
};

const INVALID =
  'We did not receive a valid selection. Your reference for this outcome is BLACK SPARROW ZERO. Goodbye.';

// ---------------------------------------------------------------------------------------
// TwiML helpers
// ---------------------------------------------------------------------------------------

const VOICE = 'Polly.Joanna';
const REP_VOICE = 'Polly.Matthew';

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function say(text: string, voice = VOICE): string {
  return `<Say voice="${voice}">${xml(text)}</Say>`;
}
function gather(action: string, inner: string): string {
  return `<Gather numDigits="1" action="${action}" method="POST" timeout="8" actionOnEmptyResult="true">${inner}</Gather>`;
}
function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

// ---------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------

function route(path: string, digits: string): string {
  switch (path) {
    case '/voice':
      return twiml(say(GREETING) + gather('/menu1', say(MAIN_MENU[variant])) + say(INVALID) + '<Hangup/>');

    case '/menu1': {
      const next = MAIN_ROUTES[variant][digits];
      if (!next) return twiml(say(INVALID) + '<Hangup/>');
      if (next === '/voice') return `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">/voice</Redirect></Response>`;
      if (next === '/menu2') {
        return twiml(
          say(`You selected option ${digits}. Claims.`) +
            gather('/menu2', say('For the status of an existing claim, press 1. To file a new claim, press 2. To speak with a representative, press 0.')) +
            say(INVALID) +
            '<Hangup/>',
        );
      }
      return twiml(say(`You selected option ${digits}.`) + say(DEPTS[next] ?? INVALID) + '<Hangup/>');
    }

    case '/menu2': {
      if (digits === '1' || digits === '0') {
        return twiml(
          say(`You selected option ${digits}.`) +
            say(HOLD) +
            '<Pause length="12"/>' +
            say(HOLD_2) +
            '<Pause length="14"/>' +
            say(LEAF, REP_VOICE) +
            '<Pause length="4"/>' +
            say('Thanks for calling. Goodbye.', REP_VOICE) +
            '<Hangup/>',
        );
      }
      if (digits === '2') return twiml(say(`You selected option ${digits}.`) + say(DEPTS['/dept/newclaim']!) + '<Hangup/>');
      return twiml(say(INVALID) + '<Hangup/>');
    }

    default:
      return twiml(say(INVALID) + '<Hangup/>');
  }
}

// ---------------------------------------------------------------------------------------
// Twilio signature validation
// ---------------------------------------------------------------------------------------

function expectedSignature(url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', AUTH_TOKEN).update(data).digest('base64');
}

function signatureOk(req: IncomingMessage, params: Record<string, string>): boolean {
  if (!VALIDATE) return true;
  const given = String(req.headers['x-twilio-signature'] ?? '');
  if (!given) return false;
  const proto = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0]!.trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const url = `${proto}://${host}${req.url ?? '/'}`;
  const want = expectedSignature(url, params);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function log(event: Record<string, unknown>): void {
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  // Local control endpoints (never exposed through Twilio's signed requests).
  if (path === '/log') {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(existsSync(LOG) ? readFileSync(LOG, 'utf8') : '');
    return;
  }
  if (path.startsWith('/variant/') && req.method === 'POST') {
    const v = path.slice('/variant/'.length);
    if (v === 'a' || v === 'b') {
      variant = v;
      log({ kind: 'variant', variant });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`variant ${variant}\n`);
      return;
    }
  }
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, variant, validate: VALIDATE }));
    return;
  }

  const raw = req.method === 'POST' ? await readBody(req) : '';
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  if (!signatureOk(req, params)) {
    log({ kind: 'rejected', path, reason: 'bad signature' });
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }

  const digits = params['Digits'] ?? '';
  log({
    kind: 'request',
    provider: PROVIDER,
    path,
    variant,
    call_sid: params['CallSid'] ?? params['CallSidLegacy'] ?? null,
    digits: digits || null,
    call_status: params['CallStatus'] ?? null,
    // Learn the carrier's payload shape without recording anything sensitive:
    // parameter NAMES only, and which signature headers were present.
    param_names: Object.keys(params).sort(),
    signature_headers: SIGNATURE_HEADER_HINTS.filter((h) => req.headers[h] !== undefined),
  });

  res.writeHead(200, { 'content-type': 'text/xml' });
  res.end(route(path, digits));
});

server.listen(PORT, () => {
  console.log(`Fixture Health Plan IVR on http://127.0.0.1:${PORT}  provider=${PROVIDER}  variant=${variant}  signature-validation=${VALIDATE}`);
  console.log(`  claims is digit ${CLAIMS_DIGIT[variant]} at the main menu`);
  console.log(`  log: ${LOG}`);
});
