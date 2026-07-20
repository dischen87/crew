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
- The worktree moved while agents worked in parallel. Final local HEAD after
  this run was `ab1aaa9f64acad23ef4235de549192afbfdb3231`; this record is runtime
  evidence, not commit or deploy proof.

## What passed

1. `ios/01-community-source.png` is the real Community Feedback source screen
   immediately before the explicit screenshot action.
2. `maestro/02-capture-preview.yaml` tapped the production
   `community-feedback-compose-screenshot` action and passed the Compose,
   preview, and consent-control assertions. `ios/02-compose-native-preview.png`
   visibly contains the exact prior Community screen inside the native preview.
3. `ios/03-consent-selected.png` shows the real consent checkbox selected. The
   earlier text assertion for `AUSGEWÄHLT` was selector-only noise: this checkbox
   exposes a selected style/checkmark rather than that literal label.
4. The retained-file oracle found exactly one account-private PNG before an
   explicit terminate/relaunch and exactly one afterwards. No path, URI, bytes,
   hash, bearer, or account identifier was passed into JavaScript or written to
   this evidence. `ios/05-after-restart.png` records the relaunched signed-in
   app state.
5. Logout used the visible Events action and native `Abmelden?` confirmation.
   The first text selector was ambiguous and left the alert open; the bounded
   continuation in `maestro/06-confirm-logout.yaml` confirmed the visible alert,
   reached `private-access-signed-out`, and the external oracle then found zero
   retained PNGs. `ios/06-logout-purged.png` records the signed-out state.

## Submit boundary — not an upload pass

The mandatory text fields were filled in `maestro/03-fill-and-consent.yaml`,
and the selected consent state is visible in `ios/03-consent-selected.png`.
From that state, `maestro/04-submit-consented.yaml` completed both the scroll to
`feedback-compose-submit` and the tap. The subsequent 90-second success wait
timed out. `ios/04-submit-stalled.png`, captured after the completed tap, shows
the submit control disabled in its in-flight state; it is not a pre-submit form
with missing required text.

The server oracle after the wait remained:

```text
event_feedback=0
event_feedback_attachments=0
event_attachments=0
event_attachment_uploads=0
```

Therefore this run proves that the consented action entered the client submit
path but did not reach server-side attachment prepare. It does **not** prove an
object-store upload attempt, upload failure, upload success, commit, feedback
creation, retry, or replay. The positive capture/preview/restart/logout facts
remain valid and separately evidenced.

## Verification already rerun in this slice

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
  restart/account-switch evidence are missing.
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

Use `SHA256SUMS` to verify the six PNGs and six sanitized Maestro flows.
