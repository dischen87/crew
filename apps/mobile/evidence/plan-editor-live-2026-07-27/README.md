# Plan, Live Item and Editor native evidence — 2026-07-27

Status: **CURRENT SANITIZED IOS SIMULATOR DELIVERY-STATE MATRIX ACCEPTED;
HISTORICAL EVIDENCE RETAINED WITH ORIGINAL PROVENANCE.**

This package contains three deliberately separate evidence layers:

1. Historical original clean-source Plan, Live Item and Editor layout runs at
   `ab0e54008b1df9b6edde63292ba9dde0cd8af32f`.
2. Historical delivery-state runs under `runtime/screenshots/state-matrix`.
   Earlier iOS queued/conflict captures retain their original provenance in
   `runtime/oracles/plan-state-partial.json`; the later historical closure run
   adds iOS tombstone and all six Android state/font combinations.
3. A current accepted iOS queued/conflict/tombstone closure against base
   `91d65177cf2b4f443562f2ef98b40a84071b783e`; the exact product and test
   contents were committed as
   `39f80fd49450028928b9679e2d09de3166eb8f88`, with harness file hashes in
   `runtime/oracles/ios-current-state-matrix.json`.

Historical evidence is not rebound to current source. All runs are
simulator/emulator evidence, not distribution or physical-device acceptance.

## Current accepted iOS closure

The current matrix retains 21 unique accepted screenshots and 12 sanitized
state-specific Maestro reports with zero failures or errors. It covers queued,
conflict and tombstone across Editor, Plan and Live at `medium` and
`accessibility-extra-large`, where the existing route and harness apply.
Screenshots are under `runtime/screenshots/state-matrix/ios-current`; reports
are under `runtime/reports/state-matrix/ios-current`.

The retained set:

- retains only green state-specific reports and independently accepted
  screenshots;
- excludes authentication, route-opening, failed, ambiguous and debug
  artifacts;
- drops byte-identical Editor/Live alternates and the two issue-only Plan
  crops;
- redacts simulator identifiers from every retained report; and
- contains no retained credential, invitation token, unique device identifier
  or absolute user, workspace or temporary path. The runnable harness retains
  only the standard `/usr/bin/env` and `/usr/bin/xcrun` system executable
  paths.

The oracle records the exact two runtime source files, two regression-test
files and ten harness files by SHA-256. The final refreshed simulator app
hashes are:

- `CrewNext`:
  `242260115e2c766ce766a7fd90cebc41446276dc92a57cd0a0f15e23d9909f4f`
- `CrewNext.debug.dylib`:
  `8cf0c35467ebaad657843ed3f0c5b781836005e54538397c525e007f7992d803`

One provenance exception is explicit: `conflict-editor-default` was captured
before the final AXL-only StatusChip v3 refresh. At default size/font scale 1,
it is accepted source-equivalent state evidence, but it is not claimed as
exact final-refresh bundle-timing evidence.

## Historical closure run

The historical closure run used `main`/`origin/main` base
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

The historical state screenshots are under
`runtime/screenshots/state-matrix`; their sanitized JUnit reports are under
`runtime/reports/state-matrix`.

The Android title is visibly concatenated in the queued/conflict evidence
because Maestro's native `eraseText` retained a suffix from the pre-filled
fixture title. The screenshots prove delivery-state preservation and
large-text rendering, not polished text-entry behavior.

## Historical bound runtime

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

Exact historical source, build, runtime, state, text-scale and report bindings
are in `runtime/oracles/plan-state-matrix.json`. `SHA256SUMS` was regenerated
after final insertion and verifies the complete retained package.

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
execution, VoiceOver or TalkBack traversal, production, or an updated external
Figma file. Native Zurich DST-overlap round-trip acceptance is a documented
NO-GO with the current picker harness because it cannot deterministically
distinguish the repeated fold instant. iOS Share Sheet dismissal is not final:
no green sanitized share-dismiss artifact is retained by this package.
