# Android feedback logout isolation — 2026-07-27

Status: **CURRENT SANITIZED ANDROID EMULATOR ACCEPTANCE.**

The debug APK was built from
`903a02881553b21e51dc9cbf64731aaefd9817e4`, installed on a disposable
Android 16 / API 36 emulator, and matched the local artifact byte-for-byte:

```text
101771f4940ffa9a37248751d9f6c5878b367e5acf78d9d9ecc544b5df2718ae
```

The run used isolated loopback databases, an empty dedicated Redis instance,
and the native E2E runner without an attachment delivery backend. No retired
Crew data or production backend was used.

## Result

Seventeen Maestro runs passed with zero failures or errors. The genuine
product routes proved:

- account A retained one local feedback screenshot across a direct A → B
  account switch;
- account B added its own screenshot without changing A;
- the direct B → A switch retained both screenshots;
- visible logout of A changed A from one allow-listed screenshot to zero while
  B remained at one;
- non-allow-listed files in both account directories and one external file
  survived the logout;
- a second visible logout succeeded after A's exact native screenshot file had
  already been removed while its local receipt still existed.

`adb run-as` was used only as an external, sanitized file-count oracle and to
prepare the exact missing-target condition. Account directory IDs, native
filenames, private paths, credentials, database URLs, device serials, and raw
logs are not retained.

The seven screenshots under `runtime/screenshots` show the pending, switched,
pre-logout, and signed-out states. They confirm that the React Native surface
was interactive rather than blank. This functional run used the emulator's
actual `1080x1920` override at density `420`; it does not claim visual parity
with a different reference viewport.

## Bound runtime

| Item                        | Value                                          |
| --------------------------- | ---------------------------------------------- |
| Product source              | `903a02881553b21e51dc9cbf64731aaefd9817e4`     |
| App                         | `app.crew.next` debug                          |
| Device                      | Disposable Android emulator                    |
| OS                          | Android 16 / API 36                            |
| Raw viewport                | `1080x1920`                                    |
| Calculated logical viewport | approximately `411x731 dp`                     |
| Density                     | `420 dpi`                                      |
| Metro                       | React Native 0.86 on isolated host port `8082` |

The sanitized runtime oracle is
`runtime/oracles/android-logout-isolation.json`.

## Re-run

Start `infra/native-e2e-runner.ts` with new loopback-only test databases, an
empty dedicated Redis database, control port `3101`, and fresh in-memory
bearers. Omit all optional attachment delivery configuration so local pending
media cannot reconcile during account switching.

Create the deterministic owner/organizer fixture:

```sh
bun auth-control.mjs prepare
```

Build and install the exact debug app:

```sh
cd <crew-new>/apps/mobile/android
./gradlew :app:assembleDebug \
  -PreactNativeDevServerPort=8082 \
  -PreactNativeArchitectures=arm64-v8a \
  -PcrewNativeE2ERequestId=crew-e2e.android \
  --no-daemon
```

Authenticate account A outside Maestro with `auth-control.mjs`, run the four
feedback flows, and call `transport-control.mjs detach` immediately before the
submit flow. Reattach only for the credential-safe account switch. Repeat for
account B, switch back to A without logout, then run `90-visible-logout.yaml`.

Use a transient `adb run-as` coordinator to validate only direct regular
single-link media matching the native allow-list. Keep all account directory
IDs and filenames in shell memory. For the second logout, remove exactly the
one validated A media file after the pending receipt is visible, then run the
same visible logout flow again.

## Boundaries

This is emulator evidence, not a physical-device or signed-distribution run.
It does not claim TalkBack traversal, physical-device storage behavior,
production-backend behavior, or a new visual-design acceptance. Those
boundaries remain explicit.
