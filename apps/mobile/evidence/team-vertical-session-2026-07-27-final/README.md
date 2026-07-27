# Crew team vertical — final coherent native acceptance

Status: **PASS** on the isolated local native-acceptance boundary.

This package binds one fresh runner setup, one root event, one Android build,
one entitlement-bearing iOS build, and one source revision:

- evidence run: `crew-paq-8-3-75a6761-20260727t201546z`
- source and `origin/main`: `75a6761c046758a89e8b84349ac80766d827d637`
- root event: `evt_local_team_day_2026`
- fixture scenario: `team-event`; there is no Turkey or golf fixture dependency
- 21/21 JUnit test cases passed with zero failures
- 22 native screenshots were retained
- 8 sanitized gateway traces prove detached retention, committed-response loss,
  idempotent replay, convergence, and feedback creation
- the slow feedback-compose window passed native UI and logcat gates with zero
  React Native LogBox or unhandled-error matches

## Accepted journey

1. The API fixture created the team event, owner membership, invitation, and
   participant redemption in one isolated setup.
2. The iOS owner completed authentication, Plan, Live, event editing, and both
   Crew-tab states.
3. The Android participant authenticated, opened Crew and the feed, submitted
   while the gateway transport was detached, survived a true app relaunch,
   retained a committed request whose successful response was suppressed,
   replayed the same idempotent request, and converged.
4. The iOS owner read the converged feed item from the same root event.
5. The same Android emulator captured a screenshot, passed the slow-typing
   error gates, kept screenshot consent off in preview, queued exactly one
   feedback submission, delivered one committed attachment, proved server
   readback after a cold restart, and logged out.

## Object-store harness diagnosis

The first attachment grant encountered ten HTTP 507 responses from the
isolated MinIO harness because the host filesystem was below MinIO's low-disk
threshold. No product state or database was edited. The same pending mobile
record resumed after the owned MinIO data was restarted unchanged on a sparse
test volume and Android performed a real offline-to-online transition. The
server records one expired quarantine attempt, one committed upload, one
feedback row, one feedback-attachment link, and one final event attachment.

## Evidence map

- `manifest.json`: run boundary, exact execution order, counts, and phase result
- `setup.json`: sanitized fixture and session binding
- `build-provenance.json`: source-to-installed-binary equality and iOS signing
- `traces/gateway.json`: sanitized gateway trace records
- `oracles/feed-response-loss-replay.json`: offline/replay/convergence oracle
- `oracles/feedback-server-readback.json`: feedback, upload, and object oracle
- `oracles/zero-react-native-errors.json`: slow-compose UI/logcat oracle
- `oracles/session-coherence.json`: single-session binding
- `android/reports`, `ios/reports`: sanitized JUnit reports
- `android/screenshots`, `ios/screenshots`: native visual evidence
- `flows`: all 21 YAML flows, copied before execution
- `SHA256SUMS`: integrity inventory for every other retained artifact

## Boundary

This is isolated local evidence from a fresh disposable iOS simulator and a
clean Android API 36 emulator. It does not claim physical-device,
distribution-build, staging, or production acceptance. No credentials, magic
links, access tokens, device identifiers, tunnel hostnames,
environment-specific absolute paths, database names, object-store identifiers,
or raw device logs are retained.
