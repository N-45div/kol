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

`npm run demo` replays three fictional healthcare cases: a verified paid claim, a plausible
answer from the wrong department, and a changed keypress trail. It never touches the network.

The seeded evaluation covers 640 cases across eight families: clean paid, clean denied,
fabricated amount, wrong department with matching numbers, question never asked, route
mismatch, missing independent route receipt, and low provider confidence. Current result:

```text
safe results accepted 160/160
unsafe results held   480/480
unsafe auto-accepts   0
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

```bash
npm run web:dev
```

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
web/              judge-facing fixture lab and guarded live evidence workflow
schemas/          portable route interchange contract
```

## Current proof

- 72 automated tests pass with zero root runtime dependencies, on every push in CI.
- The 640-case synthetic adversarial matrix has zero unsafe auto-accepts.
- CALL-E completed a guarded call to an allowlisted India destination with 14 transcript turns.
- Prose-guided keypad replay is demonstrated live through the `/call` IVR route replay against
  a human-read menu, with an operator-attested receipt; a fixture-logged or audio-decoded
  receipt is still the stronger witness and is not represented as completed.
- CALL-E contribution merged upstream on 11 Sep 2026 as `skills/kol-ivr-route` and
  `apps/typescript/kol`: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/453

## License

MIT
