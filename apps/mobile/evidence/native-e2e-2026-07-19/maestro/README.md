# Production-route Maestro phases

These flows drive only the real Crew navigation tree and the native E2E facade
on port `3000`. Fixture setup, transport control, trace reads and magic-link
redemption remain outside Maestro in the credential-safe control wrapper.

## Fixed boundaries

- Metro stays on `8082`; never touch `8081`.
- Android is exactly `emulator-5554`; iOS is exactly
  `F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`.
- Never use `clearState`, clear a keychain, uninstall the app or run this folder
  as one suite.
- iOS relaunches must be performed by the coordinator with
  `-RCT_jsLocation localhost:8082`; iOS flows that follow a relaunch therefore
  do not call `launchApp`.
- No access token, refresh token, magic link, invitation token, control bearer
  or delivery bearer belongs in a flow, environment variable or test output.
- The checked-in `.test` fixture emails and message bodies are deterministic
  non-credential inputs.

## Team matrix order

The complete, checkpointed order is documented in
[`../team-two-user-matrix-runbook.md`](../team-two-user-matrix-runbook.md).

Orientation A uses Android as participant and iOS as owner:

1. `40-team-participant-magic-request.yaml` on Android; wrapper redemption.
2. `41-team-owner-magic-request.yaml` on iOS; wrapper redemption.
3. `20-team-participant-bootstrap.yaml` on Android.
4. Coordinator clears traces, allow-lists `crew-e2e.android`, then detaches.
5. `21-team-participant-queue.yaml`.
6. Oracle checkpoint, then `21a-team-android-participant-after-relaunch.yaml`.
7. Oracle checkpoint; coordinator arms the fault and attaches.
8. `21b-team-participant-fault-retained.yaml` for the suppressed success.
9. Oracle checkpoint, then `22-team-participant-converged.yaml` for replay.
10. `23-team-owner-readback.yaml` on iOS.

Orientation B reverses the devices and uses a distinct message:

1. Real UI logout with `28-team-android-logout-from-feed.yaml` and
   `29-team-ios-logout-from-feed.yaml`.
2. Participant request/redeem on iOS and owner request/redeem on Android.
3. `20-team-participant-bootstrap.yaml` on iOS.
4. Coordinator clears traces, allow-lists `crew-e2e.ios`, then detaches.
5. `24-team-ios-participant-queue.yaml`.
6. Oracle checkpoint, exact coordinator iOS relaunch, then
   `24a-team-ios-participant-after-relaunch.yaml`.
7. Coordinator arms the fault and attaches.
8. Reuse `21b-team-participant-fault-retained.yaml`, then
   `22-team-participant-converged.yaml`.
9. `25-team-android-owner-readback.yaml` on Android.

The generic fault and convergence phases intentionally do not match body text;
the orientation-specific queue, relaunch and owner-readback phases bind the
exact body while the Oracle and runner bind the identical mutation fingerprints.

## Invocation

```sh
cd /Users/mathias/diisi_projekte/crew-new
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  /Users/mathias/.maestro/bin/maestro test \
  --device emulator-5554 \
  apps/mobile/evidence/native-e2e-2026-07-19/maestro/20-team-participant-bootstrap.yaml
```

For iOS, replace only the device and final filename:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  /Users/mathias/.maestro/bin/maestro test \
  --device F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3 \
  apps/mobile/evidence/native-e2e-2026-07-19/maestro/20-team-participant-bootstrap.yaml
```

Keep Maestro debug and test output outside the repository.

## Scope truth

The production Event Hub currently opens a root-scoped Team feed and therefore
posts `eventId: null`. The service/API fixture descriptor in
`infra/bootstrap-fixture.ts` uses the child Decisions event. The native matrix
proves the real production root-feed route and must not be described as a
byte-identical execution of that service-only descriptor.

Golf phases `00`-`13` and the Golf-specific role-switch helpers `30`-`31b`
remain unchanged except that Team work must use a fresh runner setup.
