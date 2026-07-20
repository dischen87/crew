# Android Release feedback replay

Captured on 2026-07-20 with a fresh, non-debuggable Android `releaseEvidence`
build on a disposable API 36 emulator. This closes the Android half of the
durable Community Feedback Release-shaped replay gate.

## Result

The real production route
`Events -> Event Hub -> Mehr -> Community Feedback -> Feedback geben` created
one text-only private report through `FeedbackComposeScreen`, encrypted SQLite,
`FeedbackSubmissionController`, `FeedbackDeliveryPump`, `GatewayClient`, the
API Gateway, and the event service.

Across three verified process deaths, the final clean trace was exactly:

1. transport detached: facade `503`, no downstream call;
2. cold process: transport detached again, facade `503`, no downstream call;
3. cold process: downstream committed `201`, facade deliberately returned
   `503`;
4. cold process: downstream idempotent replay returned `201` with
   `replayed=true`.

All four attempts retained one identical request, body, feedback, and
idempotency SHA-256 fingerprint. A fifth cold launch stayed at four traces for
five seconds, proving that the delivered local row was not resent.

Read-only PostgreSQL verification found exactly one feedback row, one initial
status-history row, zero attachments, zero diagnostics, and one completed
HTTP-201 feedback idempotency record.

## Release and harness boundary

- `releaseEvidence` inherits the normal `release` build type, embeds a Hermes
  bundle, and was verified non-debuggable (`flags=0`; `run-as` rejected).
- The fresh APK was locally signed with the repository debug certificate only
  for emulator installation. APK Signature Scheme v2 and v3 passed. This is
  not a distribution-signing or Play Store claim.
- The existing Android Release-evidence entry supplies only the isolated
  loopback Gateway transport, one fixed allow-listed test request ID, and the
  fixture-only secret-link bootstrap. It still mounts the production
  `FeedbackDeliveryPump`, `PrivateBootstrapGate`, `RootNavigator`, secure
  stores, and screens.
- No feedback runtime, controller, queue, database, UUID, digest, retry,
  response, or service implementation was replaced or wrapped. The static
  source boundary rejects `randomUUID:` and `sha256:` seams in the evidence
  entry.
- The variant-specific network security file permits cleartext only for
  `127.0.0.1` and `localhost`. Its base config remains cleartext-denied.
- Normal shipping Release remains unchanged: empty native test request ID,
  cleartext disabled, and an unconfigured or non-canonical HTTPS Gateway stays
  network-fail-closed.

The on-device crypto dialog proves this exact APK had secure random values and
a secure Keychain-backed device UUID, while `crypto.randomUUID` and
`crypto.subtle.digest` were absent. The feedback run therefore exercised the
production secure UUID composition and the default bounded SHA-256 fallback.

## Privacy and evidence

`sanitized-proof.json` retains only statuses, booleans, aggregate counts, and
one-way fingerprints. It contains no raw report title/body, feedback/account/
device ID, idempotency key, token, magic link, bearer, session, or database
row. The deterministic non-secret fixture route selector remains in the final
Events semantics so the capture can be tied to the documented test fixture.

The screenshots deliberately show only the sanitized crypto dialog and the
fifth-launch Events shell. No post-input screenshot was retained. Semantics
files contain the same non-secret states.

## Execution note

A preliminary orchestration attempt was discarded before the final run: the
process was stopped when the facade recorded its first detached request, before
JavaScript had persisted the returned `503` out of its sending lease. It made
no downstream call and PostgreSQL still contained zero feedback rows. The
isolated evidence app sandbox was reinstalled, traces were cleared, and the
final run above waited briefly for each local failure transition before the
verified process death.

No commit, push, deployment, store upload, or distribution signing was
performed.

## Gates and cleanup

- fresh `assembleReleaseEvidence`: pass;
- mobile Jest: 63/63 suites, 514/514 tests;
- mobile-data: 142/142 tests, 998 assertions;
- native runner guard/control tests: 14 pass, 1 PostgreSQL-env skip, 177
  assertions; the retained run itself exercised fresh PostgreSQL live;
- app and mobile-data TypeScript/lint: pass;
- source manifest and evidence formatting: pass.

The evidence package and reverse mapping were removed, emulator `5560` was
stopped, its `CrewFeedbackReleaseApi36` AVD was deleted, the runner and isolated
Redis were stopped, both exact temporary PostgreSQL databases were dropped, and
all transient payload/setup/credential files were permanently removed. The
original emulator `5554`, Metro `8081`/`8082`, and their processes remained
live and unchanged.
