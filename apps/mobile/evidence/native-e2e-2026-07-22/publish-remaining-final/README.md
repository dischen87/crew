# Event Hub native final acceptance — 2026-07-22

This directory is the retained, sanitized acceptance set for the final Event
Hub publish flow. It binds the current production UI source to native iOS
behavior, release artifacts and the same-input Turkey Golf visual comparison.

## Accepted outcome

- 40 native JUnit flows passed with zero failures and zero errors.
- 26 API, transport and database oracles passed.
- Medium and Accessibility Extra Large content sizes were exercised on an
  iPhone 16e simulator running iOS 26.2.
- Template selection, place recovery, offline restart, conflict recovery,
  publish recovery, role boundaries and membership loss were exercised.
- Event Hub normal and large-text states retain complete titles, controls,
  navigation and reachable actions.
- The singular participant label is `1 teilnehmende Person` in the UI,
  accessibility summary and final iOS/Android bundles.
- `runtime/logical/53-option2-reference-vs-current-source-820x900.png` compares
  the binding Option 2 reference with a fresh Release build of the unchanged
  Turkey Golf input through the current production `EventHubView`.

## Evidence boundary

`FINAL-ALLOWLIST.txt` is the sole retained acceptance boundary.
`SHA256SUMS` hashes every allowlisted file except itself. Everything below
`runtime/diagnostics/` is intentionally excluded: it contains harness
development, pre-fix runs and failed/intermediate attempts and is not release
evidence.

JUnit device fields contain only the generic device name and OS version. The
retained allowlist contains no simulator UUID, absolute local path, bearer,
JWT, credential URL, private key or persisted secret value.

`build-verification.json` records the final Metro, native executable, iOS
bundle, Android APK/Hermes and static Release hashes. Historical preflight
harnesses are bound through their checksum manifest and control-script hashes
instead of being copied into this set.
