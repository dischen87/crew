# Plan, Live Item and Editor native evidence — 2026-07-27

Status: **CURRENT SANITIZED SIMULATOR EVIDENCE; PARTIAL NATIVE
ACCEPTANCE.**

The Android and iOS runs were built and executed from
`ab0e54008b1df9b6edde63292ba9dde0cd8af32f` on clean `main`, with
`origin/main` at the same commit. They used isolated local native E2E
services and the deterministic `evt_local_turkey_golf_2026` fixture.

## Result

Four Maestro runs passed with zero failures and retained five screenshots
each:

- Android API 36 at system font scales `1.0` and `2.0`.
- iPhone 16e, iOS 26.2, at `medium` and
  `accessibility-extra-large`.
- Each run covers Plan, Live Item, the Live Item action area, Plan Item
  Editor, and the Editor action area.

The screenshots are under `runtime/screenshots`; JUnit reports are under
`runtime/reports`. `SHA256SUMS` binds every retained artifact. The sanitized
runtime oracle is `runtime/oracles/build-and-runtime.json`.

## Supplemental Plan-state run

A second, bounded iOS run used current `main` source
`fecd688a79a6fc2801774c5d1d0c74721825656b`, the same deterministic fixture,
and a freshly erased iPhone 16e simulator. Its built and installed Debug
executable hashes both equal
`c10d78e881e40579f872fe6fc8b6c3d85e9e2d021be7f41a25ad8a4f5407f0e5`.

This run retained two genuine production-path states:

- `runtime/screenshots/state-matrix/ios/01-queued.png` shows the offline
  Gloria edit preserved in Plan with its `Lokal gespeichert` delivery badge.
- `runtime/screenshots/state-matrix/ios/02-conflict.png` shows the same local
  edit preserved after an independent production itinerary `PATCH` advanced
  the server item from version `1` to `2`; Plan identifies the conflict and
  offers the local discard action.

The retained local title is visibly concatenated because Maestro's native
`eraseText` did not clear the pre-filled title. It is evidence of state
preservation, not a polished-copy or text-entry claim.

`runtime/reports/ios-plan-open.xml` is the sanitized, zero-failure JUnit for
opening the production Plan route in this run. It is intentionally not
described as a state-specific assertion report: Maestro's exact-text
orchestration reports were red because native accessibility combined adjacent
labels, so those reports and all ambiguous screenshots were excluded. Both
retained state screenshots were inspected directly. Exact provenance and the
stop boundary are recorded in
`runtime/oracles/plan-state-partial.json`.

The agreed stop gate then fired: the one allowed tombstone-preparation flow
reached a blank native frame before the discard action. No tombstone artifact
was retained, and no Android state run was started after that gate. The
Android debug build completed, but build completion is not claimed as Android
state evidence.

Cleanup was verified after capture: the Crew app was removed, the owned iPhone
simulator was erased and shut down, no Android device remained connected,
ports `3000`, `3101`, `5433`, `6380`, and `8082` were closed, the foreign
listener on `8081` was unchanged, `Podfile.lock` matched `HEAD`, and generated
build/runtime artifacts were moved to Trash.

## Bound builds

| Platform | Runtime | Build proof | Text sizes |
| --- | --- | --- | --- |
| Android | `SwissActivities_API36`, Android 16 / API 36, `1080x2400` | Local and installed debug APK SHA-256 `21a2d49eeefb9ababbc9f20e4f6ba21328c906b148d322aa6e9e143e26330a0e` | `1.0`, `2.0` |
| iOS | iPhone 16e simulator, iOS 26.2, `1170x2532` | Built and installed simulator executable SHA-256 `c4c19dfdedc9a2fa3b68547c2a6e71e497a725e44a14016015685731b31a80ae` | `medium`, `accessibility-extra-large` |

Metro ran on isolated port `8082`. The pre-existing listener on `8081` was
verified unchanged before and after the run. Source SHA, `origin/main`, clean
worktree state, installed build hashes, text settings, JUnit results, and
artifact dimensions were checked by the runner.

## Re-run

The retained `maestro/plan-live-editor.yaml` is credential-free.
Authentication and fixture setup must happen through the repository's native
E2E controls before running it. The first Plan-tab tap uses Maestro's native
no-change retry plus one conditional retry because iOS can consume the first
accessibility tap while settling the deep-link transition. The final editor
capture uses deterministic swipes to the bottom because Maestro's iOS
visibility polling can misclassify fully rendered bottom actions.

## Explicit remaining boundaries

This package does not claim distribution-signed builds, physical-device
execution, VoiceOver or TalkBack traversal, Android queued/conflict/tombstone
states, iOS tombstone state, state-specific passing JUnit, or an updated
external Figma file. iOS queued and conflict are the only newly evidenced
state transitions. The other acceptance gates remain open in
`crew-paq.3.21`.
