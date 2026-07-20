# Auth, invite and event-switching evidence

Captured on 2026-07-18 with the Crew Next Debug app on an iPhone 17 Pro
simulator (iOS 26.2). The installed app was built at
`/tmp/crew-new-ios-evidence/Build/Products/Debug-iphonesimulator/CrewNext.app`
and loaded the current JavaScript bundle from Metro on port 8082.

The controlled server is the real `services/api-gateway` `createApp` running on
`127.0.0.1:3000` with deterministic in-process downstream responses. Its
`/__evidence` endpoint emits only redacted counts, booleans and operation names.
It never records request bodies, tokens, sessions or idempotency-key values.

## Result

- A real iOS form submitted one email magic-link request and displayed the
  enumeration-safe accepted message.
- A secret-bearing Debug deep link was sanitized into a protected opaque handle
  before navigation. Redeem installed the returned account session and opened
  its actor-scoped event list.
- The Debug deep-link delivery produced two redeem calls with one stable
  idempotency key. The duplicate did not create a second identity transition.
- The invite preview exposed only title, role and usability.
- The first invite redeem intentionally returned 503. The route stayed
  recoverable; reload plus the second redeem used the same idempotency key and
  joined successfully.
- Two roots named `Weekend` remained distinct by `rootEventId`; the joined root
  was then fetched through the actor-authenticated Gateway path.
- The persisted summary reports `rawSecretsRecorded: false`.

See [gateway-summary.json](./gateway-summary.json) for the exact redacted trace.

## Screenshots

- `02-magic-request-accepted.png`: real form submission and enumeration-safe
  acknowledgement.
- `03-events-after-magic-redeem.png`: actor-scoped event list after atomic
  session replacement.
- `04-sanitized-invite-preview.png`: sanitized invite preview with no raw token.
- `05-redeem-retryable-failure.png`: concealed retryable failure; pending state
  is retained.
- `06-event-after-stable-retry.png`: successful retry and authorized event.

The `maestro-*.yaml` files are the exact device interactions used for the form,
failure and retry assertions.

## Automated gates

`bun run check:mobile-app` passed:

- ESLint: zero errors and warnings.
- TypeScript: `tsc --noEmit` passed.
- Jest: 14 suites, 47 tests, zero failures.
- `git diff --check -- apps/mobile`: passed.

Focused regressions cover protected-route restart/dedupe and replacement cleanup,
conditional return completion races, persisted magic-request idempotency,
email-bound invite account switching, Release custom-scheme rejection, session
Keychain corruption/reset/read failures, and fail-closed bootstrap reads.

## Explicit boundary

This evidence is iOS plus a local controlled Gateway. Android/composed live E2E,
production HTTPS Gateway injection, and the verified universal-link/AASA rollout
remain outside this child. Release builds reject raw secret-bearing custom-scheme
links. Item/feed/feedback/recap verticals are not claimed here.
