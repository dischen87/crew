# Private unavailable — Android Option-2 evidence

This folder records the native Android parity run for `crew-paq.3.5.6` on
`emulator-5554`: Android 16 / API 36, `sdk_gphone64_arm64`, 1080 x 2400 px at
420 dpi. It exercises the production `PrivateBootstrapGate`,
`PrivateUnavailableScreen`, and signed-out `PrivateAccessView` through the
unchanged evidence harness.

## Accepted behavior

- `Erneut versuchen` is first, mint, primary, and direct. At normal and 1.3
  font scale, Retry re-ran bootstrap while the secondary safe exit remained
  available.
- `Sicher zur Anmeldung` opens Android's native German confirmation. Its copy
  says protected offline data remains unchanged; `ABBRECHEN` and
  `ZUR ANMELDUNG` are distinct and fully visible at both scales.
- Cancelling at normal scale retained proof count 1; cancelling at 1.3 retained
  proof count 2. In both cases the unavailable surface remained in place.
- Repeating known-account confirmation twice produced exactly one guarded
  session compare-and-set to null and one matched account-scoped in-memory
  clear. Database open, migration, reconciliation, and every purge counter
  remained zero.
- When protected session storage made identity unknown, repeating confirmation
  twice reached the signed-out UI after one failed session read. Database-key,
  compare-and-set, clear, database, migration, reconciliation, and purge
  counters all remained zero.
- Known private-data failure and unknown secure-storage failure use distinct,
  truthful German status copy without displaying an account, event, token,
  path, or storage identifier. Both signed-out results contain no private
  detail.

## Persistent evidence

| Artifact                                                                                           | Purpose                                                                 |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Known failure, normal](./screenshots/raw-1080x2400/01-known-private-data-normal.png)              | Retry-first Design 2 and safe secondary escape                          |
| [Known native confirmation, normal](./screenshots/raw-1080x2400/02-known-confirmation-normal.png)  | German unchanged-data copy and native actions                           |
| [Known signed out, normal](./screenshots/raw-1080x2400/03-known-signed-out-normal.png)             | Destination after guarded exact-once transition                         |
| [Known failure, 1.3 font scale](./screenshots/raw-1080x2400/04-known-private-data-large-top.png)   | Uncropped large typography and reachable actions                        |
| [Known native confirmation, 1.3](./screenshots/raw-1080x2400/05-known-confirmation-large.png)      | Readable native dialog and actions at large text                        |
| [Unknown secure storage, normal](./screenshots/raw-1080x2400/06-unknown-secure-storage-normal.png) | Distinct fail-closed device-protection state                            |
| [Unknown signed out, normal](./screenshots/raw-1080x2400/07-unknown-signed-out-normal.png)         | Non-destructive result without trusted identity                         |
| [Native semantics](./semantics/)                                                                   | Read-only UIAutomator hierarchy for every persisted image               |
| [Interaction proof](./native-interaction-proof.json)                                               | Sanitized counters, APK/bundle binding, cancel and double-confirm facts |
| [Maestro flows](./maestro/)                                                                        | The nine executed native interaction slices                             |
| [Design QA](./design-qa.md)                                                                        | Visual, responsive, accessibility, copy, and privacy review             |

All PNGs are raw 1080 x 2400 emulator captures. Their paired XML files expose
the native labels and order captured at the same state.

## Proof interpretation

The final sink contains four records in order: normal Retry, known-account
double confirmation, 1.3-scale Retry, and unknown-identity double
confirmation. The second Retry record is intentional: the large-text run
launched a fresh isolated process and retried that process once.

The sink accepted counters, booleans, modes, phases, and safe reason enums
only. It did not retain raw account identifiers or session values. See
`native-interaction-proof.json` for the exact four records and build hashes.

## Evidence boundary

The Android selectors override only two evidence-only React Native `Settings`
keys before loading the unchanged harness. `check-android-boundary.mjs` binds
the harness SHA-256 and rejects selectors that import or patch bootstrap,
Keychain, session-store, database-key, database, or clear-state code.

The harness supplies in-memory failure dependencies: the known case fails
before a database opens; the unknown case fails on its first synthetic session
read before a key or database is reachable. It never calls the real session
store, Keychain, account database, Gateway, query cache, attachment store, or
purge services.

The locally installed `app.crew.next.evidence` variant was non-debuggable and
separate from `app.crew.next`. It used the repository debug certificate solely
for emulator evidence, so this is neither a distribution-signing nor a
same-package-upgrade claim.

## Accessibility boundary

Read-only UIAutomator semantics show this unavailable-state order: title,
description, status, unchanged-data message, `Erneut versuchen`, then
`Sicher zur Anmeldung`. The native dialog order is title, explanation,
`ABBRECHEN`, then `ZUR ANMELDUNG`. This run did not enable TalkBack and makes
no spoken-output claim; it preserves the emulator's accessibility settings.

## Gates

- Android boundary check: pass.
- All nine Maestro flows: executed successfully on `emulator-5554`.
- Focused Jest: 4 suites, 49 tests, pass.
- Mobile TypeScript and ESLint: pass.
- Android selector, boundary, and Maestro Prettier check: pass.
- Android raw-identifier scan: pass.

The production-source aggregate was verified again after the evidence run.
The final value and the exact emulator-restoration boundary are recorded in
`design-qa.md`; this folder does not claim full Debug app-data restoration.
