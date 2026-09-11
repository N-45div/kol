# Kol

**Verified payer-call operations for healthcare revenue-cycle teams.**

A medical biller should not have to choose between spending twenty-five minutes on a payer
phone tree and trusting an AI-generated financial answer. Kol uses CALL-E to chase a claim,
remembers the IVR route for the next chase, and withholds the result unless independent
witnesses support the claim, the destination, and the route taken.

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
- `/call` runs either a reachability check or a fixed fictional claim-evidence role-play. It
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

- 63 automated tests pass with zero root runtime dependencies.
- The 640-case synthetic adversarial matrix has zero unsafe auto-accepts.
- CALL-E completed a guarded call to an allowlisted India destination with 14 transcript turns.
- Prose-guided keypad replay against Kol's owned IVR fixture is still a live-proof requirement;
  it is not silently represented as completed.
- CALL-E submission PR: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/453

## License

MIT
