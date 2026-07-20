# Android Release service proof — Golf scorecard Option 2

Captured on 2026-07-19 against the real local user, event and API-gateway services. This evidence proves that the production Golf scorecard runtime can create one Hole 2 score while React Native Release has no `crypto.randomUUID` and no `crypto.subtle.digest`, retain it through a killed Android process, and deliver it exactly once after retryable failures.

## Evidence boundary

- `releaseEvidence` inherits the normal `release` build type and uses the same Hermes bundle composition, native Crypto, Keychain, SQLite, `GatewayClient`, `PrivateBootstrapGate`, `RootNavigator`, `GolfScorecardRuntime` and `MobileSyncEngine` implementation.
- The evidence entry does not inject `randomUUID`, `sha256`, a fake golf runtime, or wrapped runtime methods. A static test enforces those negative boundaries.
- The variant is non-debuggable (`flags=0`, `run-as` rejected) and keeps cleartext denied by default. Its manifest permits cleartext only for `127.0.0.1` and `localhost`, so the real local services can be exercised.
- The generated package is `app.crew.next.evidence`. That suffix intentionally gives this proof a fresh Android app sandbox and Keychain namespace. It is **not** proof of an in-place upgrade or migration of the production package `app.crew.next`.
- The APK was locally signed with the repository debug certificate only so it could be installed on the emulator. It is not a distribution-signing claim.

## Verified flow

1. A fresh non-debuggable Release-evidence install reported the sanitized runtime shape: secure random present, `randomUUID` absent, `subtle.digest` absent, and a Keychain-backed `dvc_` UUIDv4 successfully created.
2. The participant authenticated through the real magic-link services and opened Carya Golf Club, Hole 2.
3. Transport was detached. Strokes `5` and putts `2` were typed once and saved once. The local UI showed `LOKAL GESPEICHERT`; the participant still had zero authoritative server score rows and zero mutation receipts.
4. A detached sync returned 503. Android PID `8797` was force-stopped and verified absent. A cold process with PID `9752` reopened the score as `5`/`2`, still locally queued.
5. Every detached request retained the same complete request-body and idempotency fingerprints.
6. The next request committed downstream with HTTP 200, but the controlled facade suppressed that response and returned 503. The app correctly kept the score queued.
7. The next request used the identical fingerprints, received an idempotent replay (`replayed=true`) and converged to `SYNCHRON` / `Alle Score-Daten synchronisiert`.
8. Read-only PostgreSQL verification found exactly one participant score and one mutation receipt: Hole 2, 5 strokes, 2 putts, net 4, 2 Stableford points, version 1. Both the persisted client mutation ID and device ID matched strict UUIDv4 forms. Exactly one completed HTTP-200 sync idempotency record exists for the participant.
9. An independently authenticated organizer snapshot returned HTTP 200. Privacy was preserved (zero participant-private score records), while its authoritative shared leaderboard contained exactly one matching projection: rank 1, 2 Stableford points, 1 completed hole.

The full sanitized machine-readable record is in `sanitized-proof.json`. It contains hashes, statuses and counts only; no bearer, session, magic-link, generated user, device, mutation, receipt or idempotency value is retained. Maestro intentionally retains the deterministic, non-secret local fixture route selector `evt_local_turkey_golf_2026` and its `.example.test` participant email so the flow remains reproducible.

## Visual and semantic artifacts

- `screenshots/raw-1080x2400/` contains the original emulator captures.
- `screenshots/normalized-412x915/` contains review-sized copies.
- `semantics/` contains the corresponding Android UI Automator trees.
- `maestro/` contains the exact user-level flows.

The strongest paired states are:

- `scorecard-restarted-offline`: the killed-and-relaunched app still shows 5/2, local Stableford 2 and `LOKAL GESPEICHERT`.
- `committed-response-suppressed`: the server has committed, the facade returned 503, and the device still truthfully shows the queued state.
- `scorecard-synced`: the identical replay converged to `SYNCHRON`, 5/2 and a 2-point leaderboard projection.

## Execution note

The first score-entry flow initially asserted the wrong local net label (`Netto 3` instead of the rendered and server-confirmed `Netto 4`). At that point the values had been typed once, but no local save, request trace or server score existed. `04b` continued from those untouched inputs and performed the single save; the corrected reproducible `04` now expects `Netto 4`.

Likewise, the committed-503 flow first expected the generic offline-copy message, while this valid post-commit state exposes the more precise `Offline gespeichert · nächster Versuch folgt`. The request itself completed exactly as intended and no replay had run yet. Finally, the replay flow's status assertions passed, but its optional abbreviated leaderboard label (`2 Pkt.`) did not exist; `08b` verified the actual accessibility projection without another mutation or retry. The retained flows contain the corrected labels and the proof JSON records the single mutation identity throughout.

## Reproduction and gates

Run the Maestro files in numeric order around the runner controls described by `infra/native-e2e-runner.ts`: clear/allow traces, detach before `04`, record the first detached retry, kill the package process, run `06`, retry while detached, arm the one-shot committed-response fault, attach, then run `07` and `08`.

The final gate set and exact counts are recorded in `sanitized-proof.json`. `asset-manifest.sha256` binds this README, proof, flows, screenshots and semantic trees; `source-assets.sha256` binds the production runtime and Release-evidence boundary sources used to build the APK.
