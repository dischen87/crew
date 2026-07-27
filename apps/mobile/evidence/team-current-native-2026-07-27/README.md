# Current Crew journey native evidence — 2026-07-27

Status: **CURRENT SANITIZED DEBUG-RUNTIME EVIDENCE; PARTIAL NATIVE
ACCEPTANCE.**

Both native shells and the Metro source were built from
`b3d56a21161c1764f7c5410cfff53da4db7ebaa5` on `main`. The runs used
isolated local native E2E services and the deterministic
`evt_local_team_day_2026` fixture. They are simulator/emulator evidence, not
production-backend or distribution-build evidence.

## Result

Eight retained Maestro runs passed with zero failures:

- iOS owner at Large Text: Plan, Live Item, and Plan Item Editor.
- iOS owner: the Crew tab opens team setup and a team decision.
- Android participant: the Crew tab opens the participant decision.
- Android participant: a feed entry remains queued across relaunch and an
  acknowledged-downstream/failed-facade response, then replays and converges.
- iOS owner: the converged participant feed entry is visible after sync.

The package retains exactly 13 inspected screenshots under
`runtime/screenshots` and eight sanitized JUnit reports under
`runtime/reports`. The reports contain no device identifiers or absolute
local paths. `SHA256SUMS` binds every retained artifact.

The runtime oracles are:

- `runtime/oracles/build-and-runtime.json` — exact source and installed build
  hashes.
- `runtime/oracles/offline-replay.json` — sanitized transport/facade/downstream
  trace sequence and stable fingerprints.
- `runtime/oracles/team-fixture.json` — sanitized fixture and synced-system
  payload checks.

## Bound debug builds

| Platform | Runtime | Build proof | Text setting |
| --- | --- | --- | --- |
| iOS | iPhone 16e simulator, iOS 26.2, `1170x2532` | Built and installed executable SHA-256 `c7cecfc6a945997ea665735f463483bbe3ba630c28180852b895f88149dee4b1` | `large` |
| Android | Android 16 / API 36 emulator, `1080x2400` | Local and installed debug APK SHA-256 `27e9a5026ed2c776159022dd1e0f9c4f541e0d395c2e65b5a0435d144f01da22` | `1.0` |

Metro ran on isolated port `8082`. The unrelated listener on `8081` was
verified unchanged. The retained artifacts are debug simulator/emulator
artifacts only; no distribution signing is claimed.

## Re-run

The retained `maestro` flows contain no credentials. Authentication and
fixture setup must happen through the repository's native E2E controls before
running them. The fixture was created through public application contracts;
no legacy-data migration was involved.

## Related evidence

- The broader Plan/Live/Editor text-scale matrix is retained in
  [`../plan-editor-live-2026-07-27`](../plan-editor-live-2026-07-27/).
- Feedback and team native evidence from the separate acceptance session is
  retained in
  [`../feedback-team-native-2026-07-27`](../feedback-team-native-2026-07-27/).

## Explicit remaining boundaries

This package does not claim:

- production deployment or signed distribution artifacts;
- physical-device execution;
- VoiceOver or TalkBack traversal;
- native Create/Invite execution in this exact integrated run;
- queued, conflict, or tombstone Plan visuals;
- an updated external Figma handoff;
- feedback execution in this exact integrated session.

The deterministic event and roles were prepared through public APIs. The
related feedback package above remains separate evidence rather than being
inferred into this run.
