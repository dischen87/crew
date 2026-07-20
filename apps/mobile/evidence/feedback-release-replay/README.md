# Native feedback replay evidence

Captured 2026-07-20 for the production `Events -> Event Hub -> More -> Community Feedback -> Feedback geben` flow, using Design 2 and the real `FeedbackSubmissionController` path.

## Result

Both native platforms produced the same four-request proof after a text-only submission:

1. transport detached -> facade `503`, no downstream call;
2. process death and cold launch -> byte-identical detached retry;
3. process death, transport attached, controlled fault -> downstream `201`, facade `503`;
4. process death and retry -> downstream `201`, facade `201`, replay recognized.

All four requests had identical request, body, feedback, and idempotency SHA-256 fingerprints. PostgreSQL then contained exactly one feedback row, one initial status row, no attachment, no diagnostics, and one completed `201` feedback idempotency row. A fifth cold launch left the trace count at four.

The production route and empty composer are retained visually. During the run, the UI showed the local pending receipt and the fifth cold launch produced no resend; the post-input screenshot was intentionally not retained. The sanitized runner trace and database aggregates are authoritative for exact-once delivery.

## Build and runtime boundaries

- **iOS:** local Release-shaped evidence only. It used an existing non-Debug native shell, a freshly generated current-source minified JS bundle, and ad-hoc signing. There was no fresh native compile and this is not App Store evidence.
- **Android replay:** fresh current-source **Debug** APK on an isolated disposable emulator, served by an isolated Metro `8083` process through a device-only reverse. This is not a Release-APK network E2E claim.
- **Android release boundary:** a separate fresh current-source `releaseEvidence` APK embedded the recorded Hermes release bundle. It was locally debug-signed with APK Signature Scheme v2/v3 and is not a distribution artifact. The release variant correctly remains network fail-closed; its crypto shape is linked separately to an existing real Release runtime proof in `../golf-scorecard-option-2/android-release-service/`.
- No deployment, commit, push, store upload, or distribution signing was performed.

## Visual evidence

The list captures are the real route with a cached shell plus an honest remote-refresh error. They are **not** Ready/convergence evidence. The lavender error card intentionally shifts content below it.

The composer captures were taken before any text was entered. No submitted title, body, token, link, account/event/feedback/request/idempotency identifier, or database payload is retained here.

See [design-qa.md](design-qa.md) for the reference comparison and `sanitized-proof.json` for hashes, statuses, aggregate counts, and restoration results.

## Isolation and cleanup

- The exact iPhone 16e was restored to the original Debug app/data state; four app-file hashes and the final screenshot matched the preflight snapshot byte-for-byte.
- Android used only the temporary emulator on `5558`; the package, reverse mappings, emulator, and isolated Metro `8083` were removed/stopped.
- Existing Metro processes on `8081` and `8082`, the original Android emulator on `5554`, and the other booted iPhone were not changed.
- Runner ports, Redis, PostgreSQL, temporary databases, and retained transient payload/debug files were removed after evidence extraction.
