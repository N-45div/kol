# The free IVR fixture

No carrier, no phone number, no money. Answers the question that decides whether Kol
exists — **can CALL-E be steered through a phone menu by prose alone?**

## Why this exists

The obvious fixture is a real DID with a programmable IVR behind it. We tried, in cost order:

| Option | Outcome |
| --- | --- |
| **Amazon Connect** (free tier DID, we had $100 of credits) | ❌ `InvalidRequestException: You're signed in with an AWS account that was provided by AISPL. These accounts cannot create Amazon Connect instances.` |
| **Amazon Chime SDK Voice** (PSTN numbers via Lambda) | ❌ `ForbiddenException: not authorized due to not supported countryCode = IN` |
| Twilio trial (we had a US number, `+1 606…`) | ❌ **Trial numbers reject inbound calls from any caller ID not verified on the account** (Twilio changelog: "Inbound Calls to Trial Accounts must use Verified CallerID"). CALL-E's call arrived as SIP `603 Decline` in 6 seconds with zero Twilio call record. Verified live, Sep 5. Cannot be fixed by verifying CALL-E's number — the OTP would go to CALL-E. |
| Twilio paid | ✅ works, but gated behind a $20 upgrade; trial credit cannot be used for it |
| Plivo / Telnyx | $0.50–$1/month; trial inbound policy being checked |

Both AWS telephony products are geo-restricted away from Indian-entity accounts, so the
credits are useless for this. Rather than pay a vendor *before* knowing the product works,
the laptop plays the menu itself.

## How it works

CALL-E dials your phone. You answer on speakerphone and set the phone beside the laptop. The
laptop plays a synthetic menu into the call and simultaneously records everything through its
own microphone. The DTMF tones CALL-E sends are in that recording, and a Goertzel decoder
reads them back out.

```
CALL-E ──dials──> your phone ──speaker──> laptop mic ──> call.wav ──> decoder ──> "2 1"
                       ^                                                  |
                       └──────── laptop speakers play the menu ───────────┘
```

**Ground truth without trusting the model.** The structured result tells us what CALL-E
*says* it pressed. The recording tells us what it *actually* pressed. Those disagreeing is
itself a finding — and it is precisely the failure mode Kol exists to catch.

## Open loop, on purpose

The menu does not branch. It plays the main menu, waits, plays the submenu, waits, then holds
and connects. We are not testing whether an IVR can branch — we know it can. We are testing:

1. Does CALL-E press keys at all, or does it try to talk to the menu?
2. When the task prose says "press 2, then press 1", does it press 2 then 1?

An open loop answers both, and question 2 **is** P3, the probe the whole product rests on.

What it cannot show: that a wrong turn leads somewhere wrong. For that, and for the demo
video, a real DID is better — but only worth buying once P3 says yes.

## Running it

Once, to build the menu audio (Windows speech engine, offline):

```powershell
powershell -ExecutionPolicy Bypass -File fixtures\laptop\make-audio.ps1
```

Then, per call — start this first, it waits for you:

```powershell
powershell -ExecutionPolicy Bypass -File fixtures\laptop\run-fixture.ps1
```

In another terminal, with `KOL_SELF_LINE` set in `.env`. `--via self` dials that number instead
of the DID fixture, and picks the region and locale from its country code:

```bash
KOL_MODE=live node --env-file=.env probes/run.ts p3 --via self --confirm
```

Answer the call, switch to speakerphone, put the phone next to the laptop, press Enter in the
PowerShell window. When it finishes:

```bash
npm run dtmf -- fixtures/laptop/recordings/call-<timestamp>.wav
```

## Reading the result

| Decoder output | What it means |
| --- | --- |
| `2 1` | **P3 passes.** Prose steers navigation. Replay is possible; Kol is real. |
| Some other sequence | It navigates but does not follow directions. Explore works, Replay does not. |
| Nothing, and the transcript shows it *saying* "two" | It treats menus conversationally. Check whether a more machine-like menu changes it. |
| Nothing, and the transcript shows no menu handling | It never engaged the menu. Fall back to SecondLine. |

Verified before first use: ffmpeg captures this laptop's mic to 8 kHz mono correctly, the
decoder reads that file, and it reports no digits for ambient room noise rather than
inventing them. Six decoder tests cover every keypad key, tone-under-speech, and false
positives.

## Notes

- Recordings and generated audio are gitignored. They contain a real call.
- If your mic enumerates differently, pass `-MicDevice "<name>"`; list them with
  `ffmpeg -list_devices true -f dshow -i dummy`.
- Speakerphone matters. Through an earpiece the tones may not reach the mic cleanly.
