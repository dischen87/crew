# Plan, Live Item and Editor native evidence — 2026-07-27

Status: **CURRENT SANITIZED SIMULATOR EVIDENCE; PLAN DELIVERY-STATE
MATRIX COMPLETE.**

This package contains two deliberately separate evidence layers:

1. The original clean-source Plan, Live Item and Editor layout runs at
   `ab0e54008b1df9b6edde63292ba9dde0cd8af32f`.
2. The delivery-state runs under `runtime/screenshots/state-matrix`. Earlier
   iOS queued/conflict captures retain their original provenance in
   `runtime/oracles/plan-state-partial.json`; the closure run described below
   adds a fresh iOS tombstone and all six Android state/font combinations.

The simulator matrix is not distribution or physical-device acceptance.

## Closure run

The closure run used `main`/`origin/main` base
`f9087f4d002e76a1c0e202cf9a4af26a5df1fff4` plus the exact, pre-existing
three-file UX working-tree diff recorded by content hash in
`runtime/oracles/plan-state-matrix.json`. The evidence runner did not edit
application source. Those exact three file contents were subsequently committed
without change as `a705063bbe6479e4281e889da0054b0d53c60459`.

Seven state-specific Maestro reports passed with zero failures:

- Freshly erased iPhone 16e, iOS 26.2: tombstone at the default content size.
  The prior blank-frame stop condition did not reproduce.
- Android 16 / API 36: queued, conflict and tombstone at system font scales
  `1.0` and `2.0`.
- Android conflict and tombstone visibly show `Aktion erforderlich`.
- Android queued visibly shows `Lokal gespeichert`.

The state screenshots are under `runtime/screenshots/state-matrix`; their
sanitized JUnit reports are under `runtime/reports/state-matrix`.

The Android title is visibly concatenated in the queued/conflict evidence
because Maestro's native `eraseText` retained a suffix from the pre-filled
fixture title. The screenshots prove delivery-state preservation and
large-text rendering, not polished text-entry behavior.

## Bound runtime

The iOS tombstone executable SHA-256 is
`546fc56a604b8745ce138cfa8dbb76696f656e70f7165351ecfa9e423aa52b9f`.

All six Android states used the same debug APK:

`566acc7d073a21db94c92256d18b74b0be77b7e17027d5e5797be2e08ab4d9b2`

The Android APK was built with
`-PreactNativeDevServerPort=8082`. The exact dev bundle cached by the Android
application has SHA-256:

`c5fc1d1b316dc19c16c005d475d3458aa47bd0114f9cf21be7acf4835b1799a1`

The first Android diagnostic launch used the default port and contacted the
pre-existing Metro on `8081`, exposing a React Native `0.83` JavaScript /
`0.86` native mismatch. That failed diagnostic was excluded. Rebuilding with
the explicit isolated `8082` resource removed the mismatch; only the passing
`8082` evidence is retained.

Exact source, build, runtime, state, text-scale and report bindings are in
`runtime/oracles/plan-state-matrix.json`. `SHA256SUMS` binds every retained
artifact after sanitization.

Cleanup was verified after capture: the Crew app was removed, the owned
iPhone 16e simulator was erased and shut down, the owned Android emulator was
stopped, ports `3000`, `3101`, `5433`, `6380`, and `8082` were closed, the
foreign listener on `8081` remained PID `45252`, `Podfile.lock` matched
`HEAD`, and generated build/runtime artifacts were moved to Trash.

## Original layout runs

The original Android and iOS runs were built and executed from clean
`ab0e54008b1df9b6edde63292ba9dde0cd8af32f`, with `origin/main` at the same
commit. They used isolated local native E2E services and the deterministic
`evt_local_turkey_golf_2026` fixture.

Four Maestro runs passed with zero failures and retained five screenshots
each:

- Android API 36 at system font scales `1.0` and `2.0`.
- iPhone 16e, iOS 26.2, at `medium` and
  `accessibility-extra-large`.
- Each run covers Plan, Live Item, the Live Item action area, Plan Item
  Editor, and the Editor action area.

The original runtime oracle is `runtime/oracles/build-and-runtime.json`.

## Earlier iOS queued/conflict run

The bounded iOS run at
`fecd688a79a6fc2801774c5d1d0c74721825656b` retained:

- `runtime/screenshots/state-matrix/ios/01-queued.png`
- `runtime/screenshots/state-matrix/ios/02-conflict.png`

Its exact provenance, JUnit scope and former stop boundary remain in
`runtime/oracles/plan-state-partial.json`; they are not silently rebound to
the newer closure-run source.

## Remaining boundaries

This package does not claim distribution-signed builds, physical-device
execution, VoiceOver or TalkBack traversal, or an updated external Figma file.
