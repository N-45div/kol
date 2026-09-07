# IVR fixture — "Fixture Health Plan"

A synthetic two-level phone menu with a hold queue, used for every Kol development call.
Nothing here dials a real business, and no real company's name, voice, logo or hold music
appears — which also keeps the demo video clear of the third-party trademark and music
restrictions in the hackathon rules.

## The design problem this solves

The naive fixture asks CALL-E to navigate a menu and then believes its own report of which
keys it pressed. That is the exact failure mode Kol exists to guard against: a
structured result that disagrees with what actually happened. A probe that trusts the model's
self-report proves nothing.

So the fixture **echoes the digit back**. Each level speaks the key it received
(`You selected option {{Digits}}`), and the leaf speaks a passphrase reachable only by
getting all the way through. Both land in CALL-E's own transcript, so ground truth arrives
through a channel the model cannot fabricate: the fixture said it, or it didn't.

## Setup — three TwiML Bins, no server, no hosting

Twilio Console → **Developer tools → TwiML Bins**. Create these in reverse order, since each
one needs the URL of the next.

### Bin 3 — `kol-fixture-leaf`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">You selected option {{Digits}}. Connecting you to a claims representative.</Say>
  <Say voice="Polly.Joanna">Your call is important to us. Please continue to hold.</Say>
  <Pause length="12"/>
  <Say voice="Polly.Joanna">Please continue to hold. Your estimated wait time is under one minute.</Say>
  <Pause length="14"/>
  <Say voice="Polly.Matthew">Claims, this is Dana. How can I help you today?</Say>
  <Pause length="3"/>
  <Say voice="Polly.Matthew">Let me look that up. Claim four four seven one was paid on August twelfth, in the amount of one thousand two hundred and forty dollars. Your reference is GREEN FALCON SEVEN. Is there anything else?</Say>
  <Pause length="4"/>
  <Say voice="Polly.Matthew">Thanks for calling. Goodbye.</Say>
</Response>
```

### Bin 2 — `kol-fixture-submenu`

Point `action` at Bin 3's URL.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="https://handler.twilio.com/twiml/PASTE_BIN_3_SID" method="POST" timeout="8">
    <Say voice="Polly.Joanna">You selected option {{Digits}}. Claims. For the status of an existing claim, press 1. To file a new claim, press 2. To speak with a representative, press 0.</Say>
  </Gather>
  <Say voice="Polly.Joanna">We did not receive a selection. Goodbye.</Say>
</Response>
```

### Bin 1 — `kol-fixture-main` (variant A)

Point `action` at Bin 2's URL. This is the number you put in `KOL_FIXTURE_LINE`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thank you for calling Fixture Health Plan. This is a test line.</Say>
  <Gather numDigits="1" action="https://handler.twilio.com/twiml/PASTE_BIN_2_SID" method="POST" timeout="8">
    <Say voice="Polly.Joanna">Please listen carefully, as our menu options have recently changed. For member eligibility, press 1. For claims, press 2. For provider services, press 3. To repeat this menu, press 9.</Say>
  </Gather>
  <Say voice="Polly.Joanna">We did not receive a selection. Goodbye.</Say>
</Response>
```

Then: **Phone Numbers → your number → A call comes in → TwiML Bin → `kol-fixture-main`.**

## Variant B — the drift demo

Copy Bin 1 to `kol-fixture-main-b` and swap the order, so claims moves from 2 to 3:

> For claims, press 3. For member eligibility, press 1. For provider services, press 2.

Switching the number's webhook from variant A to variant B is a two-click change on camera.
A cached route that presses 2 now lands in provider services, the leaf passphrase never
arrives, and the fingerprint of the prompt no longer matches — which is exactly the drift
Kol is built to detect and repair.

## Ground truth

| Signal | Means |
| --- | --- |
| Transcript contains `You selected option 2` | It pressed 2 at the main menu. Not a self-report. |
| Transcript contains `GREEN FALCON SEVEN` | It reached the leaf. Both levels were navigated. |
| Structured result claims success without the passphrase | The model is wrong about its own call. Log it. |

The passphrase is deliberately absurd so it cannot be confabulated from context, and it is
rotated per probe run.

## Cost and lifetime

One US number, about $1.15/month, plus per-minute inbound. The hackathon rules require the
project stay testable until the **judging period ends Oct 13 2026**, so this number stays
paid and pointed at variant A until then.
