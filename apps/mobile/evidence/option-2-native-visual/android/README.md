# Android Option 2 feedback evidence

Captured on 2026-07-19 from `emulator-5554` with the deterministic
`android-runner-entry.js` pure-view harness.

## Scope

- Device: `sdk_gphone64_arm64`, Android API 36, `arm64-v8a`.
- Physical capture: 1080x2400 at density 420.
- Logical review copy: 412x915.
- Text settings: real Android `font_scale=1.0` and `font_scale=2.0`.
- Design direction: frozen Option 2 only.
- Data: synthetic feedback, diagnostics metadata and screenshot preview. No
  backend, authentication, account, invite code or production secret was used.

## Evidence sets

- `feedback-compose/raw`: original 1080x2400 screenshots.
- `feedback-compose/logical`: 412x915 review copies.
- `feedback-compose/semantics`: matching UIAutomator hierarchies with labels,
  checked/focused state and bounds.
- `community-feedback/{raw,logical,semantics}`: source, safe capture failure
  and disabled capture-progress surfaces.
- `feedback-compose/comparison/logical/03-diagnostics-before-after-normal-combined-824x915.png`:
  a single same-state input, before on the left and final on the right. The two
  separate 412x915 inputs are retained beside it.
- `feedback-responsive-qa.md`: findings, measurements, provenance and honest
  acceptance boundaries.
- `asset-manifest.sha256`: hashes for the evidence, harness, production view,
  focused tests and referenced product documents.

## Reproduction

The checked-in Maestro flows under `maestro/` select a deterministic state,
scroll to the exact control and exercise semantic taps. The Release harness was
built with:

```sh
ENTRY_FILE=evidence/option-2-native-visual/android-runner-entry.js \
RCT_NO_LAUNCH_PACKAGER=1 \
./gradlew app:assembleRelease --rerun-tasks --no-daemon
```

The local APK was signed only with the repository debug certificate for this
emulator run. It is not release-signing or store-distribution evidence.
