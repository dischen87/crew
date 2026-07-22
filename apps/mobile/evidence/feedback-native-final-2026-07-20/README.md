# Native feedback screenshot acceptance — 2026-07-20

This is a bounded iOS runtime acceptance record for the production Community
Feedback and Feedback Compose routes. It is not a release, deploy, Android, or
full parent-bead closure claim.

## Runtime boundary

- Device: iPhone 17 Pro simulator, iOS 26.2, physical screenshots
  `1206x2622`.
- Isolation: temporary bundle `app.crew.next.feedbackfinal` on the assigned
  iPhone 17 Pro, Metro `8084`, native request channel `crew-e2e.ios`.
- Backend: isolated user/event PostgreSQL databases, Redis database 12 on
  `6380`, the production Gateway/User/Event controllers, and the existing
  `BunS3PrivateObjectStore` plus attachment worker against a temporary private
  MinIO bucket. The API grant endpoint was HTTPS; the worker used a loopback
  endpoint. No fake upload transport or second queue was introduced.
- The correction rerun used local HEAD
  `a1b5be8fde25f702dfe252a6dd755c48713ef9d3`, equal to `origin/main` when the
  rerun started. This record is runtime evidence, not deploy proof.

## What the retained record establishes

1. `ios/01-community-source.png` is the real Community Feedback source screen
   immediately before the explicit screenshot action.
2. `maestro/02-capture-preview.yaml` tapped the production
   `community-feedback-compose-screenshot` action and passed the Compose,
   preview, and consent-control assertions. `ios/02-compose-native-preview.png`
   visibly contains the exact prior Community screen inside the native preview.
3. `ios/03-consent-selected.png` shows the real consent checkbox selected. The
   earlier text assertion for `AUSGEWÄHLT` was selector-only noise: this checkbox
   exposes a selected style/checkmark rather than that literal label.
4. The corrected sanitized flow asserts distinct exact values for
   `feedback-compose-title` and `feedback-compose-body`, the consent semantic
   state `checked=true` with `enabled=true`, the label
   `Feedback mit Screenshot senden`, and
   `feedback-compose-submit enabled=true` before one ID-based tap. A correction
   attempt was observed to reach a local receipt and temporary payload-free
   diagnostics, but neither result was retained. The YAML recipe is therefore
   not an executed submit proof; a fresh retained run is required.
5. The retained-file oracle found exactly one account-private PNG before an
   explicit terminate/relaunch and exactly one afterwards. No path, URI, bytes,
   hash, bearer, or account identifier was passed into JavaScript or written to
   this evidence. `ios/05-after-restart.png` records the relaunched signed-in
   app state.
6. Logout used the visible Events action and native `Abmelden?` confirmation.
   The first text selector was ambiguous and left the alert open; the bounded
   continuation in `maestro/06-confirm-logout.yaml` confirmed the visible alert,
   reached `private-access-signed-out`, and the external oracle then found zero
   retained PNGs. `ios/06-logout-purged.png` records the signed-out state.

## Submit boundary — hang disproven, retained submit proof pending

The original submit interpretation in this directory was wrong. The original
continuation put the intended body text into the title field while
`feedback-compose-body` remained empty. Its submit control was therefore
`enabled=false`. Maestro reported a completed tap command against that disabled
element, but the app's `onPress` never ran. Consequently,
`ios/04-submit-stalled.png` is a historical invalid pre-submit capture, not an
in-flight or stalled submission. The filename is retained so the immutable
historical checksum remains attributable; it must not be cited as hang proof.

The sanitized flows now encode the corrected interaction. In particular,
`maestro/03-fill-and-consent.yaml` scrolls the multiline field into view before
the body tap and asserts the two field values separately.
`maestro/04-submit-consented.yaml` is self-contained and requires the consent
semantic value, consented submit label, and `enabled=true` before one submit
tap. However, this directory contains no receipt screenshot, Maestro execution
result, sanitized SQLite/Post-Commit oracle, or other retained artifact proving
that the corrected recipe completed. A transient observation is not accepted as
runtime evidence.

The server oracle after the wait remained:

```text
event_feedback=0
event_feedback_attachments=0
event_attachments=0
event_attachment_uploads=0
```

The zero server oracle proves only that no server-side feedback or attachment
object was created during the bounded observation. It cannot establish a local
SQLite commit without a retained local oracle. This run does **not** prove an
object-store upload attempt, upload failure, upload success, server commit,
server feedback creation, retry, replay, or corrected local submit completion.
The capture, preview, restart-retention, logout-purge, and invalid-old-hang facts
remain separately evidenced.

## Verification already rerun in this slice

- Correction attempt: enabled submit, SQLite commit, and a pending receipt were
  observed transiently, but no receipt or local DB oracle was retained. An
  independent audit therefore rejected this as a runtime acceptance claim.
  Visible logout separately reduced the isolated retained-PNG oracle from 2 to 0.
- Correction focused Mobile Jest: 3/3 suites and 30/30 tests passed.
- Correction focused MobileData Bun: 37/37 tests and 147 assertions passed.
- Mobile and MobileData TypeScript passed; MobileData Biome checked 32 files;
  the corrected evidence JSON/YAML/Markdown passed formatting checks and all
  twelve `SHA256SUMS` entries verified.
- Mobile focused Jest: 11 suites, 139/139 tests passed.
- MobileData focused Bun tests: 41/41 tests, 203 assertions passed.
- Isolated Event Service PostgreSQL integration: 18/18 tests, 248 assertions
  passed; its temporary database was dropped.
- Native runner guard suite after the optional real-object-store wiring:
  14 passed, 1 environment-gated skip, 180 assertions.
- Current iOS native app compiled successfully with Xcode for the isolated
  bundle and launched against Metro `8084` before this runtime run.

## Beads acceptance result

No additional screenshot child is closed by this run:

- `crew-paq.6.2.2.2` remains open: real upload/commit and complete cross-platform
  restart/account-switch evidence are missing. The reported submit hang is
  disproven, but the corrected iOS consented-submit portion still lacks retained
  receipt and local DB evidence.
- `crew-paq.6.2.2.3` remains open: iOS capture/preview/restart/logout is now
  positive, but Android runtime, safe capture failure/text-only recovery, and
  account switching remain.
- `crew-paq.6.2.2.4` remains open: server prepare stayed at zero, so no native
  HTTPS upload or object-integrity proof exists.
- `crew-paq.6.2.2.5` remains open: the actual iOS preview passed, while actual
  Android preview and the remaining negative/account-switch cases are absent.
- `crew-paq.6.2.2.6` remains open: exact iOS logout purge passed, while Android
  runtime and explicit A-to-B no-purge account-switch proof remain absent.
- Parents `crew-paq.6.2.2` and `crew-paq.6.2` remain open for those same gates.

The separately closed duplicate-suggestion, diagnostics-consent, and Community
route beads are not reopened by this attachment-specific gap.

## Cleanup

The feedback runner and temporary object store were stopped. Ports `3000`,
`3105`, `6380`, `8084`, `9002`, `9003`, and `20241` were verified free; both
temporary PostgreSQL databases were dropped; the isolated app was uninstalled;
the original `app.crew.next` app remained installed. The temporary directory,
including ephemeral credentials, was permanently removed after evidence
extraction.

The correction rerun repeated visible logout and verified zero retained PNGs,
then stopped its exact runner, Redis, and Metro processes; dropped its exact
user/event databases; uninstalled only `app.crew.next.feedbackfinal`; and
verified `3000`, `3105`, `6380`, and `8084` free before handing those ports to
the next isolated agent run. The original `app.crew.next` remained installed.

Use `SHA256SUMS` to verify the six PNGs and six sanitized Maestro flows.
