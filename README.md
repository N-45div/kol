# Kol

[![validate](https://github.com/N-45div/kol/actions/workflows/validate.yml/badge.svg)](https://github.com/N-45div/kol/actions/workflows/validate.yml)

**The AI caller is never the only witness.** Kol makes CALL-E prove a payer call: the question
it asked, the words the payer answered with, the department that answered, and the keypad
route it took must each be backed by a witness the model cannot write itself, or the answer
is held. A route that passes teaches the Route Atlas, so the next chase replays it by keypad
instead of exploring the phone tree again.

This is only possible because one CALL-E request returns a speaker-labelled, time-offset
transcript, a strict structured result, and keypad navigation of the phone tree together.
Kol turns those into evidence that can disagree with each other.

Built for healthcare revenue-cycle teams, where a medical biller currently spends twenty-five
minutes per claim-status call and a correctly shaped wrong answer becomes a financial record.

## The healthcare problem

The [2024 CAQH Index](https://www.caqh.org/hubfs/Index/2024%20Index%20Report/CAQH_IndexReport_2024_FINAL.pdf)
reports that a manual claim-status inquiry takes medical staff 25 minutes and that the medical
industry spent $11 billion on claim-status inquiries in 2023. The
[AMA's 2025 survey](https://www.ama-assn.org/practice-management/prior-authorization/only-1-3-doctors-trusts-insurers-prior-authorization)
reports 40 prior authorizations and 13 staff hours per physician each week, with phone still
the most common channel for medical-service prior authorization.

Automating payer calls is no longer the unoccupied idea. The unresolved operational question
is what happens after an agent says, “Claim 4471 was paid $1,240 on August 12.” A correctly
shaped answer can still be wrong, unsupported, or collected from the wrong department.

Kol treats the agent as a participant, not the sole witness.

## What makes a result usable

The claim-result gate checks:

1. **Question witness** — the CALL-E transcript must show that the agent actually asked the
   claim-specific question.
2. **Answer witness** — every status and financial field must be present in an exact payer-side
   evidence quote.
3. **Destination witness** — payer-side words must establish that the intended claims desk
   answered; matching numbers from another department are still rejected.
4. **Route witness** — the model-reported keypress trail must match an independent fixture log,
   decoded DTMF audio, or provider event receipt.
5. **Provider corroboration** — low CALL-E confidence can downgrade a result, but high confidence
   can never override missing evidence.

Only a verified call may teach the Route Atlas. A contradiction quarantines the route so the
next call explores instead of confidently repeating a stale path.

## What a biller gets beyond one call, one claim

- **Several claims on one call.** A biller reads six claim numbers off a list once they are
  through the tree. Kol asks the representative to name each claim with its answer, and then
  binds every answer to its claim in the payer's words. The failure only a batch can have is
  the swapped answer: every number spoken, every quote real, claim A filed with claim B's
  amount. The single-claim gate passes it; the batch gate contradicts it. A claim nobody asked
  about is contradicted, an unanswered claim is held, a quote that names no claim goes to a
  person.
- **CALL-E's own evidence is cross-examined.** The provider attaches free-text justifications
  to a result. They are the model explaining itself, so a justification that narrates an
  amount or status the payer never said blocks auto-accept.
- **A PHI guard that refuses to dial.** Everything in a chase request is spoken aloud to
  whoever answers. A member ID, date of birth, diagnosis code, patient name, SSN, email or
  phone number in the question stops the call before it is compiled, and the refusal masks
  what it found. A claim number and a dollar amount pass.

## Route Atlas

Each route is versioned by `(payer line, goal)` and stores menu levels, actions, timings,
confirmations, and corrections.

- **Explore:** CALL-E listens to the current menu and reports the prompts and actions.
- **Replay:** Kol compiles a proven route into the next CALL-E task, while instructing the agent
  to abandon it immediately when the real menu differs.
- **Repair:** option-to-key fingerprints distinguish harmless rewording from remapped or
  restructured menus. A verified re-navigation replaces the stale route.
- **Quarantine:** a contradicted answer cannot update route memory.

Mapping the menu is an efficiency feature. Evidence-gated claim results are the product.

## Safe, zero-call demonstration

Requires Node.js 22.18 or newer.

```bash
npm install
npm run demo
npm test
npm run eval
```

`npm run demo` replays four fictional healthcare cases: a verified paid claim, a plausible
answer from the wrong department, a changed keypress trail, and three claims on one call with
one answer filed under the wrong claim. It never touches the network.

The seeded evaluation has two matrices. Single claim per call: 720 cases across nine
families (clean paid, clean denied, fabricated amount, wrong department with matching
numbers, question never asked, route mismatch, missing independent route receipt, low
provider confidence, provider evidence unsupported). Several claims per call: 1,280 claim
verdicts across five families (clean, crossed answer, invented claim, unanswered claim,
ambiguous quote). Current result:

```text
single claim per call    safe accepted 160/160   unsafe held 560/560    unsafe auto-accepts 0
several claims per call  safe accepted 960/960   unsafe held 320/320    unsafe auto-accepts 0
```

These are synthetic evaluation results, not a measurement of CALL-E or payer-call accuracy.
See [METHODOLOGY.md](METHODOLOGY.md) for the claim boundary.

## Judge-facing product

Live Vercel demo: **https://kol-verified-payer-calls.vercel.app**

- `/` explains the healthcare problem and Kol's evidence model.
- `/console` contains the claim worklist, fixture evidence lab, observed live receipt, Route
  Atlas, and methodology.
- `/call` places one guarded live call in one of three modes: a reachability check, a fixed
  fictional claim-evidence role-play, or an **IVR route replay**, where the person who answers
  reads a two-level phone menu aloud, CALL-E replays the atlas route by keypad, and the
  operator then enters the tones they heard as a receipt independent of the model. Each mode
  displays the real transcript, structured extraction, deterministic checks, and verdict.
  Against a menu read by a person, CALL-E's agent talked over it and pressed no keys in all
  three live attempts, so that mode is shown against a stand-in CALL-E.

```bash
npm run web:dev
```

Every live chase is a **durable Vercel Workflow run**. The call is created exactly once inside
the run, with no retries and an idempotency key derived from the run, so an ambiguous outcome
can never dial twice. Polling is checkpointed, and after the call ends the run suspends on a
hook until the person who answered attaches the tones they heard, whether that takes a minute
or a day. The verdict is the run's return value. Two scripts prove it without a call:
`npm --prefix web run e2e:chase` drives one run end to end against a stand-in CALL-E, and
`npm --prefix web run e2e:crash` kills the dev server mid-poll, restarts it, and asserts the
same run finishes verified with one create.

The product UI separates synthetic and observed evidence. Fixture replay demonstrates the
complete independent-witness gate without spending credits. The guarded live path can spend a
CALL-E credit, but only for an allowlisted destination after PIN and explicit confirmation.
Its sanitised receipt is carried into the evidence console for the current browser session.

## One authorized live call

Live execution is opt-in and places a real outbound call. Use only a line you own or are
authorized to call, and never place real patient information in a hackathon test.

```bash
# .env
CALLE_API_KEY=...
KOL_MODE=live

npm run chase -- --line +1XXXXXXXXXX --goal claim_status \
  --ask "what is the current status of fictional claim 4471" --ref 4471 \
  --marker "FIXTURE DESTINATION MARKER" --confirm
```

Before dialing, Kol prints the masked destination and estimated call cost. Live requests use a
stable idempotency key; ambiguous create outcomes are not blindly redialed. Responses are
recorded in masked artifacts for replay.

## CALL-E surface Kol uses

| CALL-E capability | Where Kol depends on it |
| --- | --- |
| `POST /v1/calls` with `task`, `result_schema`, `metadata`, `Idempotency-Key` | Every live call; the atlas compiles a route into `task`, and the idempotency key stops an ambiguous outcome from dialling twice |
| IVR navigation by keypad from task prose | Replay: the route is dictated up front, so the agent does not explore |
| `structured_result` | The claim to verify. Never treated as evidence on its own |
| `transcript_turns[{offset_seconds, speaker, text}]` | Question witness, answer witness, destination witness, and menu witness are all speaker-specific transcript spans |
| `completion_confidence{score,label}` | Provider corroboration: low confidence can downgrade a verdict, high confidence can never override a missing witness |
| `GET /v1/calls/{id}` | Polling and reconciliation; every response is recorded, masked, and replayable without a network |
| `GET /v1/calls/{id}/events` | Recorded alongside each call for the audit trail |
| `webhook_url` | Accepted on the request; terminal webhooks are unsigned, so Kol reconciles through `GET` before acting on one |
| `Idempotency-Key` derived from the durable run | The create step inside the Workflow run has no retries; a replay or restart re-presents the same key and CALL-E returns the same call |

## Healthcare boundary

Kol is an administrative RCM prototype. It does not provide medical advice, diagnose, triage,
make coverage decisions, appeal denials, accept settlements, authorize payments, or write to an
EHR or practice-management system. The demo contains no PHI. This repository does not claim
HIPAA compliance or production readiness; any production deployment would require a formal
security, privacy, vendor, and BAA assessment.

## Project map

```text
src/atlas/        versioned IVR routes, fingerprints, drift, repair
src/calle/        CALL-E API transport, polling, masking, replay
src/chase/        call planning, evidence gate, escalation, preflight
src/healthcare/   claim-status schema, independent witness verifier, eval corpus
src/dtmf/         Goertzel-based DTMF decoder
fixtures/         fictional IVR and laptop-call fixtures
artifacts/        masked replay records from controlled probes
web/              judge-facing fixture lab, guarded live lab, and the durable chase run (web/workflows)
schemas/          portable route interchange contract
```

## Current proof

- 108 automated tests pass with zero root runtime dependencies, on every push in CI.
- The 2,000 synthetic adversarial verdicts (720 single-claim, 1,280 multi-claim) have zero unsafe auto-accepts.
- CALL-E completed a guarded call to an allowlisted India destination with 14 transcript turns.
- Prose-guided keypad replay against a live voice did **not** work. In three calls on
  14 Sep 2026 where a person read the two-level menu aloud, CALL-E's agent spoke over the menu
  and pressed no keys, including after it was told explicitly to stay silent and use only the
  keypad. The IVR route replay is proven end to end against a stand-in CALL-E; a live keypad
  replay against a real automated IVR remains a requirement and is not represented as done.
- CALL-E contribution merged upstream on 11 Sep 2026 as `skills/kol-ivr-route` and
  `apps/typescript/kol`: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/453

## License

MIT
