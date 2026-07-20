# iOS Release Golf Scorecard proof

This directory contains the sanitized, accepted fresh-run evidence for the iOS
Golf Scorecard offline/replay path. The crypto alert was captured from the exact
same signed artifact immediately before the clean data-container rerun; every
stateful scorecard screenshot is from the accepted fresh run. This is local
service-backed simulator proof, not a production deployment or
production-backend claim.

## What was exercised

- A signed, non-Debug iOS Simulator Release shell ran the current JavaScript
  bundle and the real app composition: secure session, private bootstrap,
  production navigation, `GolfScorecardRuntime`, and the current
  `FeedbackDeliveryPump`.
- No Golf, UUID, SHA, or sync-engine behavior was replaced by an evidence seam.
  The sanitized runtime alert confirms the expected Release crypto shape:
  `randomUUID` absent, secure `getRandomValues` present, and
  `subtle.digest` absent.
- A fresh participant data container began with zero local pending mutations.
  Exactly one Hole 1 score (5 strokes, 2 putts, 2 Stableford points) was saved
  while transport was detached.
- The exact Release PID was terminated and verified absent. A cold process
  retained the queued mutation.
- The server committed the mutation while the facade deliberately returned
  503. The local queue retained it, then replayed the same request and
  converged after the server returned the stored success.
- A fresh owner login independently read the synchronized score through the
  read-only owner scorecard.

## Immutable fixture baseline and accepted delta

Fixture setup creates one owner `golfRound` mutation receipt at sequence 1.
That receipt existed before participant authentication and remained unchanged.
The accepted participant delta is exactly one `golfScore` receipt at sequence
1 and one score row. The earlier diagnostic run is rejected and excluded from
every retained screenshot and proof record.

All five transport observations have the same body fingerprint
`sha256:430e36c3548d552aa8185249ef83cb79c1fb44e5832157ec68dea177c231b710`
and idempotency fingerprint
`sha256:fc366246a468d2299d96139bdb27106ef771f54da51468f709bde4e4b57b8a99`.
The first three were detached before downstream delivery. The fourth committed
downstream with HTTP 200 while the facade suppressed success as HTTP 503. The
fifth returned HTTP 200 with `replayed: true`.

## Release artifact

The native shell was reused from the existing non-Debug Simulator Release
artifact; no new native compile or DerivedData tree was created. Current source
was bundled with `--dev false`, the app was ad-hoc signed, and deep/strict
signature verification passed. Seventeen native input hashes remained exact,
no Debug/preview dylibs were present, and no applicable source file was newer
than the final JavaScript bundle.

Executable SHA-256:
`868e74955de934c576543a526d89cbdfcfdcd264a9796e9aaedccc10dcb05489`

JavaScript bundle SHA-256:
`be16ebd845ee65b8232333263ddf5e4e9e6c59bba0323641511dd572d9e46770`

## Evidence map

1. `01-release-crypto-proof-*`: fail-closed runtime crypto-provider proof.
2. `02-participant-local-queued-*`: one local mutation, 5/2/2 visible.
3. `03-participant-cold-relaunch-retained-*`: durable queue after exact PID cut.
4. `04-participant-committed-503-retained-*`: server commit/lost acknowledgement.
5. `05-participant-converged-*`: pending count returned to zero.
6. `06-owner-readback-*`: independent owner readback, one hole and two points.
7. `07-debug-restored-*`: the exact pre-run signed-out Debug surface restored.

`sanitized-proof.json` is the machine-readable oracle. `server-proof.sql`
returns only role/entity aggregates and score values; it emits no raw actor,
event, device, mutation, token, or idempotency identifiers.

## Restoration

Before the restored Debug app launched, its 51 app files and 30 data-container
files matched the captured manifests byte for byte. The restored screen hash
exactly matched the pre-run baseline. The original light appearance, medium
content size, `CrewEvidenceState=capability`, both Metro listeners, and the
other simulator process were unchanged.
