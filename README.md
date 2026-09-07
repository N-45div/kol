# kol

**Get past the phone tree, and remember the way.**

Kol calls the automated menu on the other end of a business phone line, finds the route to
the department you need, and writes it down. The next call to that line replays the route
instead of listening to the whole menu again. When the company reshuffles its options, Kol
notices, re-navigates, and repairs its own map.

Built on [CALL-E](https://www.heycall-e.com/).

## Why

A claim-status inquiry by phone costs a US medical billing team **25 minutes** of staff time;
the same question asked electronically takes 7. Around **$11 billion** a year goes into asking
payers questions over the phone, and roughly **$2.4 billion** of that is automatable (CAQH
2024 Index). Physicians and their staff spend **13 hours a week** on prior authorisation, and
the phone is the most common way it gets done (AMA 2025 Prior Authorization Survey, n=1,000).

None of that is a conversation problem. It is a *navigation* problem: menus, submenus, and
hold music standing between a caller and a fifteen-second answer.

Every phone agent in this space — CALL-E's own navigator, Pipecat's IVR module, Google's
Direct My Call, Apple's Hold Assist — learns the menu from scratch on every call and takes its
own word for where it ended up. **Nobody keeps the map, and nobody checks the answer against
the tree.** That gap is what Kol fills.

## How it works

### The Route Atlas

A versioned map of one line's menu tree, keyed by `(number, goal)`.

- **Explore** — the first call is told to reach a named department and to *report the menu it
  heard and the keys it pressed*. The navigation comes back through `result_schema`, so the
  call describes its own route as structured data.
- **Replay** — the stored route is compiled into the task text of later calls. CALL-E's API
  accepts no navigation parameters at all, so the Atlas has to be expressed in prose precise
  enough to steer a keypress. That compiler is the load-bearing piece of this project.
- **Repair** — the prompts heard are fingerprinted by their *option-to-key mapping*, not their
  wording, so a changed greeting is noise while a moved option is drift. The same call that
  uses a stale route also fixes it: the instructions tell it to abandon the route the moment
  what it hears stops matching, and to report what the menu says now.

### Verification

An answer is not believed because a model returned it. Four independent checks run against the
transcript, and a verdict is never better than the weakest:

| Check | Catches |
| --- | --- |
| Reached a human | Voicemail dressed up as an answer |
| Every number in the answer was spoken | The classic failure: right shape, wrong amount |
| The destination marker was heard | Landing in the wrong department and answering anyway |
| Provider confidence above a floor | The model's own uncertainty |

The number check hears `"four four seven one"` as `4471` and `"one thousand two hundred and
forty"` as `1240`, because that is how a person reads a claim number and an amount aloud.

**Only a verified call may teach the Atlas.** A contradicted call is precisely the one whose
route must not be learned — it is the evidence that the route led somewhere wrong.

## Running it

Replay is the default. No API key, no phone number, no calls placed:

```bash
npm install
npm test          # 31 tests
npm run atlas     # what Kol believes about every line it has called
```

A live call needs `CALLE_API_KEY` in `.env` (see `.env.example`), `KOL_MODE=live`, and an
explicit `--confirm`. The masked destination and the cost are printed before anything dials.

```bash
npm run chase -- --line +1XXXXXXXXXX --goal claim_status \
  --ask "what is the current status of claim 4471" --ref 4471 \
  --marker "GREEN FALCON SEVEN" --confirm
```

Every live response is written to `artifacts/` the moment it lands, and those recordings are
what replay mode reads back — so any run can be reproduced later without spending a call.

## Fixtures

`fixtures/ivr-sim/` is a two-level synthetic phone menu ("Fixture Health Plan") served as
TwiML, with a second variant where the claims option moves from 2 to 3 for testing drift. It
logs every keypress server-side, and each branch ends in a distinct passphrase, so we learn
where a call actually landed from a source the model cannot influence. Development never
dials a real business.

`src/dtmf/` decodes DTMF tones out of a call recording with a Goertzel filter — a second,
independent witness to which keys were pressed.

## Status

Working: the Atlas (fingerprinting, drift classification, store, prose compiler), the CALL-E
transport with recording and replay, the chase runner and its verification layer, the DTMF
decoder, and the IVR fixture. 31 tests, zero runtime dependencies.

Not yet proven: whether CALL-E reliably presses keys when a route is dictated to it in prose.
That is one call against the fixture, and it decides whether Replay is real or whether Kol is
Explore-and-verify only.

## Licence

MIT.
