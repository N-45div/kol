# Kol methodology and claim boundary

Kol separates three evidence classes so a polished demo cannot turn an assumption into a fact.

## Observed

- CALL-E accepted and completed a controlled hotline call and returned transcript data. The
  masked replay is committed under `artifacts/probe-p4-calle-hotline/`.
- The Route Atlas, drift classifier, escalation ladder, DTMF decoder, healthcare witness gate,
  and replay transport execute locally under automated tests.
- The deterministic healthcare matrix currently accepts 160 of 160 clean synthetic results and
  withholds 480 of 480 unsafe or incomplete synthetic results.

## Synthetic

The IVR organization, claim references, amounts, representatives, passphrases, phone numbers,
and transcripts used by the demo and evaluation are fictional. Synthetic results measure Kol's
deterministic policy against known labels. They do not measure recognition quality, payer
behavior, CALL-E reliability, or real-world clinical or financial outcomes.

The corpus contains 80 variations of each family:

| Family | Expected disposition | Failure being tested |
| --- | --- | --- |
| Clean paid | Accept | Complete, mutually consistent witnesses |
| Clean denied | Accept | Denial code and next step grounded |
| Fabricated amount | Withhold | Structured amount differs from payer quote |
| Wrong department | Withhold | Matching figures came from provider services |
| Question never asked | Withhold | Result exists without an agent question |
| Route mismatch | Withhold | Model-reported keys differ from external receipt |
| Missing route receipt | Withhold | The model is the only route witness |
| Low confidence | Withhold | Provider itself reports uncertainty |

`npm run eval` regenerates the matrix; there is no stored score file to edit.

## Inferred hypothesis

Healthcare billing teams clearly experience expensive payer-phone work. The narrower trust
problem is a product hypothesis: Kol has not yet measured how often production payer-call agents
return confident but wrong structured results, nor how much manual spot-checking RCM teams do.

The next validation interview is with an RCM operations lead:

> When an automated payer call returns a claim answer, what gets spot-checked, and what happened
> the last time the answer was wrong?

Until that interview and a consented pilot occur, Kol describes the trust problem as plausible,
not as a documented current loss rate.

## Live-proof checklist

The central replay claim becomes observed only after one authorized fixture sequence completes:

1. CALL-E explores the owned IVR and reaches its claims-status leaf.
2. The fixture's server-side log records the keys independently.
3. Kol learns the route only after all witnesses agree.
4. CALL-E replays the saved route on a second call.
5. The fixture remaps one option; Kol abandons the stale path, detects dangerous drift, and
   repairs or quarantines the route.

Every artifact must be masked and contain no private phone number, credential, call recording,
or patient information before it is committed.
