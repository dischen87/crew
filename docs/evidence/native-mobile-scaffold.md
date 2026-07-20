# Crew Next native mobile scaffold evidence

Status: Android and iOS native scaffold plus encrypted data path verified locally.
This document deliberately separates what ran from what remains a release gate.

## Product identity and runtime

| Boundary                | Verified value                                  |
| ----------------------- | ----------------------------------------------- |
| React Native            | 0.86.0, React 19.2.3                            |
| Application / bundle ID | `app.crew.next`                                 |
| Android namespace       | `com.crewnext`                                  |
| Android SDK             | min 24, compile 36, target 36                   |
| iOS minimum             | 15.1                                            |
| Architecture            | Hermes + React Native New Architecture / Fabric |
| Encrypted store         | OP-SQLite 17.1.2 with SQLCipher enabled         |
| Secret store            | react-native-keychain 10.0.0                    |

No Swiss Activities bundle ID, scheme, route, domain, asset, font, or product
copy is accepted by the scaffold leak gate.

## Shared native data probe

The reusable entry
[`apps/mobile/evidence/native-data-probe-entry.js`](../../apps/mobile/evidence/native-data-probe-entry.js)
calls the same production `getOrCreateDatabaseKey`, `openAccountDatabase`,
exclusive transaction adapter, and `@crew/mobile-data` migrations used by the
app. The Android compatibility entry imports this shared probe; it does not
contain a second implementation.

Both platform runs returned the same result:

```json
{
  "finalReadAfterWrongKey": true,
  "migrationCount": 14,
  "ordered": "first,second",
  "restartValue": "restart",
  "rollbackCount": 0,
  "rollbackThrown": true,
  "status": "pass",
  "wrongKeyRejected": true
}
```

This proves, on each native runtime:

- a 256-bit database key is obtained through the native Keychain/Keystore
  module rather than source, SQLite, AsyncStorage, or a JS fixture;
- the account database opens through the SQLCipher-enabled native OP-SQLite
  build and applies all current migrations;
- a committed row survives close and reopen;
- a wrong encryption key cannot read the database and the correct key still
  works afterward;
- a thrown transaction rolls back;
- concurrent async transaction requests execute in exclusive submission order.

## Android proof

Environment:

- Android 16 / API 36 ARM64 emulator, 1080 x 2400 at density 420
  (412 x 915 logical viewport);
- Homebrew OpenJDK 17.0.19;
- Android SDK command-line tools with Platform and Build Tools 36;
- application package `app.crew.next`, version 1.0 (1).

Build gates completed:

```sh
./gradlew :app:processDebugMainManifest :app:assembleDebug --no-daemon
./gradlew :app:assembleDebug \
  -PreactNativeDevServerPort=8082 \
  -PreactNativeArchitectures=arm64-v8a \
  --no-daemon
```

Runtime logs showed Hermes, `libreactnative.so`, `libop-sqlite.so`, and
`fabric: true`. The exported `VIEW` / `BROWSABLE` activity accepts only the
Crew-owned `crewnext` development scheme and uses `singleTask` launch mode.
Cold and warm deep-link routing has been exercised for sign-in and a malformed
invite; the latter rendered only a generic unavailable state without token,
account, or root detail in Crew UI or ReactNativeJS logs.

Evidence:

- [Android native probe, raw 1080 x 2400](android-native-scaffold/01-native-data-probe-1080x2400.png)
- [Android native probe, logical 412 x 915](android-native-scaffold/01-native-data-probe-412x915.png)

SHA-256:

```text
5131702d960f2486d47685abc2dc84b2c50c8cc6f7ac7551be7492f2fe68bcd1  01-native-data-probe-1080x2400.png
b84671c15f45f1b34203364eec0b399a46aa442f6b5ad7afa68967de0ed43762  01-native-data-probe-412x915.png
```

## iOS proof

Environment:

- iPhone 17 Pro simulator on iOS 26.2, 1206 x 2622
  (402 x 874 logical viewport);
- Xcode 26.3 on arm64 macOS 26.5.1;
- normal Xcode ad-hoc simulator signing, application package `app.crew.next`;
- Release ARM64 build with an embedded Hermes bundle.

Build gate completed:

```sh
ENTRY_FILE=evidence/native-data-probe-entry.js \
RCT_NO_LAUNCH_PACKAGER=1 \
xcodebuild -workspace ios/CrewNext.xcworkspace \
  -scheme CrewNext \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=<iPhone-17-Pro-UDID>' \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 EXCLUDED_ARCHS=x86_64 \
  build
```

Evidence:

- [iOS native probe, raw 1206 x 2622](ios-native-scaffold/01-native-data-probe-1206x2622.png)
- [iOS native probe, logical 402 x 874](ios-native-scaffold/01-native-data-probe-402x874.png)

SHA-256:

```text
f0b20c6b4209b2c996039b90f38233823166fa1b691ab3b0a97d10859c7cb045  01-native-data-probe-1206x2622.png
991c782b078cb6cb120ad2e726d80d5994c494ebe7953606efd9bdba3a67bb16  01-native-data-probe-402x874.png
```

## Honest boundary before scaffold closure

This evidence proves both native builds and both encrypted data paths. It does
not by itself claim a deployed Gateway, production signing, App/Universal Link
association files, a physical-device run, or end-to-end service composition.
Before closing the scaffold Bead, the stable final app source still needs one
fresh Android and iOS production-shell rebuild, signed-out Option-2 launch and
deep-link captures, logout/account isolation, final built-artifact leak scans,
and restoration of both simulators to a clean signed-out Crew state.
