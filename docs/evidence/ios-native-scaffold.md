# Crew Next iOS native scaffold evidence

Verified locally on 2026-07-18 with Xcode 26.3 and the booted iPhone 17 Pro
simulator running iOS 26.2. This is native scaffold evidence, not approval of a
final visual direction.

## Build and runtime

- `pod install` completed with 83 pods. Autolinking found
  `react-native-get-random-values` 2.0.0, `react-native-keychain` 10.0.0 and
  OP-SQLite 17.1.2.
- OP-SQLite reported the monorepo-root configuration and selected SQLCipher.
- A clean Debug simulator `xcodebuild` completed successfully with Hermes and
  the React Native New Architecture.
- The built and launched bundle is `app.crew.next`; its custom scheme is
  `crewnext`.
- The shipped native source/manifest leak gate found zero Swiss Activities
  bundle IDs, domains, routes, tokens or branding.

## Deep links and secret handling

- Cold event link: [ios-deeplink-event.png](ios-deeplink-event.png)
- Warm secret-bearing invite link:
  [ios-deeplink-invite.png](ios-deeplink-invite.png)
- iOS `AppDelegate` forwards warm URL callbacks through `RCTLinkingManager`.
- Hermes does not expose useful host/path fields for a custom-scheme `URL`.
  The sanitizer therefore validates the exact `crewnext://` authority and path
  through an HTTPS parser before returning a Crew URL. A Hermes-like regression
  test protects this behavior.
- Invite and auth secrets are moved into a Keychain record behind a native-CSPRNG
  UUIDv4 handle. A native probe stored, consumed and deleted an invite record;
  the second read returned `null`.
- A synthetic, test-only secure session exercised the complete signed-in path:
  Keychain session read, native database-key creation, SQLCipher open, five
  migrations and private navigation render. Evidence:
  [ios-signed-in-bootstrap.png](ios-signed-in-bootstrap.png).
- Cold and warm CrewNext log scans found zero raw test tokens, raw join URLs,
  pending-route service names or database-key service names.

## Native encrypted database probe

The real iOS OP-SQLite module, not the Jest mock, produced:

```json
{
  "status": "pass",
  "restartValue": "cipher-ok",
  "wrongKeyRejected": true,
  "migrationCount": 5
}
```

The real adapter transaction probe produced:

```json
{
  "status": "pass",
  "rollbackThrown": true,
  "rollbackCount": 0,
  "ordered": "first,second"
}
```

The probes covered SQLCipher availability, all current migrations, close/reopen
readback, wrong-key rejection, rollback and exclusive queued ordering. Both
test-only SQLite databases plus WAL/SHM files were deleted after verification.
The synthetic session, its database key and four test pending-route services
were also removed, and the app was relaunched back into the signed-out state.
These artifacts contained no user data and are not recoverable.

## Remaining boundary

Android native build and emulator evidence remain open because this host has no
JDK, Android SDK, `adb` or emulator. Android Gradle configuration is statically
covered, but no APK or Android boot is claimed.
