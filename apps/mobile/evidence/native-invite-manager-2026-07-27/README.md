# Native Invite Manager acceptance — 2026-07-27

Status: **CURRENT SANITIZED RUNTIME EVIDENCE; PARTIAL NATIVE
ACCEPTANCE.**

The native shells and Metro source were rebuilt and run from
`4cac3bc960db36ca7076233f3faf14a4ed970ca6`, the product-fix commit
immediately preceding this evidence package. The runs used isolated local
native E2E services and the `evt_publish_role_setup_final` fixture. They are
not production-backend or distribution-build evidence.

## Result

Five Maestro flow definitions passed across seven runs with zero failures:

- iOS owner: all three creatable roles are present; Invite Manager return
  navigation works.
- iOS owner: native expiry picker cancel and confirm both return safely.
- iOS owner: a default participant invitation is created online and `Fertig`
  returns to Invite Manager without opening the share sheet; the refreshed
  count and new summary are visible immediately.
- iOS owner: the role matrix also passes at
  `accessibility-extra-large`.
- Android organizer: organizer creation is absent while participant and viewer
  creation remain available.
- Android organizer: native date and time picker cancel/confirm round trips
  return safely.
- Android organizer: the narrowed role flow also passes at system
  `font_scale=2.0`, with retained Editor and Manager captures.

The JUnit reports are under `runtime/reports`; the retained screenshots show
only token-free Manager and Editor states. Raw and logical captures are kept
under `runtime/raw` and `runtime/logical`.

## Bound builds

| Platform | Runtime                                                 | Build proof                                                                                                                               | Text sizes                            |
| -------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| iOS      | iPhone 16e simulator, iOS 26.2, `1170x2532` / `390x844` | Simulator-signed `app.crew.next.invitefinalsigned`; executable SHA-256 `8b3eb2757e5f3faa41a3ecf48e5d52f8b89c74450df6982c2f66608ca8a1dc73` | `medium`, `accessibility-extra-large` |
| Android  | Android 16 emulator, API 36, `1080x2400` / `412x915`    | Installed APK and local artifact both SHA-256 `315159e35fb55fc73313a296e21e1011f81b457ecbd685b3706557a0c45ebd30`                          | `1.0`, `2.0`                          |

The sanitized build/runtime oracle is
`runtime/oracles/build-and-runtime.json`.

## Android Metro preflight

React Native 0.86 reads `debug_http_host` from Android's default app
preferences:

```text
shared_prefs/app.crew.next_preferences.xml
```

The current run set that value to `10.0.2.2:8082` before the accepted cold
start. A discarded preflight had used the wrong preference file and therefore
loaded an unrelated React Native 0.83 bundle from host port 8081. No artifact
from that failed preflight is retained. The final cold-start log gate had zero
matches for `version mismatch`, `@react-native-community/geolocation`, or
`runtime not ready`; the unrelated host process on port 8081 was not changed.

## Re-run

Authentication and magic-link redemption must happen outside Maestro through
the retained credential-safe [`control.mjs`](./control.mjs). No access token,
refresh token, magic link, invitation token, control bearer, or delivery bearer
belongs in the flows or their output.

Start `infra/native-e2e-runner.ts` with a new pair of explicit loopback test
databases, an empty non-zero Redis database on loopback port `6380`, control
port `3101`, and fresh in-memory values for the runner bearers. The database
names must match the runner guards:

```text
crew_native_e2e_user_test_<unique_run>
crew_native_e2e_event_test_<unique_run>
```

With the runner environment still exported, create the deterministic fixture:

```sh
cd <crew-new>
export NATIVE_E2E_CONTROL_URL=http://127.0.0.1:3101/
bun apps/mobile/evidence/native-invite-manager-2026-07-27/control.mjs prepare
```

`prepare` creates both local users, `evt_publish_role_setup_final`, and one
active organizer membership through public auth, root, invitation, and
redemption contracts. It prints only the root ID and expected roles. It does
not require `/v1/setup` or a retained base fixture. Stop the runner and drop
only the exact run-specific databases after capture; this added root is outside
the runner's built-in golf/team cleanup allowlist. The runner still rejects a
non-empty Redis database and clears its owned Redis keys when stopped.

Sign each exact installed app in outside Maestro. The control requests and
consumes a fresh local magic link in memory, opens the native auth return, and
prints no credential:

```sh
APP_ID=<exact-ios-bundle-id> IOS_DEVICE_UDID=<exact-udid> \
  bun apps/mobile/evidence/native-invite-manager-2026-07-27/control.mjs \
  authenticate owner ios

adb -s <exact-android-serial> reverse tcp:3000 tcp:3000
APP_ID=<exact-android-package> ANDROID_SERIAL=<exact-android-serial> \
  bun apps/mobile/evidence/native-invite-manager-2026-07-27/control.mjs \
  authenticate organizer android
```

Run one flow at a time against the exact installed app:

```sh
cd <crew-new>
JAVA_HOME=<jdk-17-home> maestro test \
  --device <exact-device> \
  -e APP_ID=<exact-installed-bundle-id> \
  apps/mobile/evidence/native-invite-manager-2026-07-27/maestro/<flow>.yaml
```

## Explicit remaining boundaries

This package does not claim physical-device execution, signed distribution
builds, VoiceOver or TalkBack traversal, physical 200% text, share-sheet
cancellation, or native DST-overlap selection. Exact DST behavior remains
covered by the focused Invite source tests. Those boundaries stay open rather
than being inferred from simulator screenshots.
