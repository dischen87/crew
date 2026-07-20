# Team two-user native matrix runbook

This runbook closes the two real-device Team rows without exposing credentials
or confusing service-fixture evidence with the production UI route.

## Immutable inputs

| Input                 | Orientation A                                     | Orientation B                                              |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Participant device    | Android `emulator-5554`                           | iOS `F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`                 |
| Owner readback device | iOS                                               | Android                                                    |
| Native request ID     | `crew-e2e.android`                                | `crew-e2e.ios`                                             |
| Exact message         | `Participant reconnect check: option B is ready.` | `iOS participant reconnect check: orientation B is ready.` |
| Root                  | `evt_local_team_day_2026`                         | `evt_local_team_day_2026`                                  |
| Production feed scope | root, `eventId: null`                             | root, `eventId: null`                                      |

Fixture identities are `crew.team.participant.local@example.test` and
`crew.team.local@example.test`. They are deterministic test inputs, not
credentials. The setup response supplies the corresponding user IDs; do not
copy session material into notes or command output.

The native app must use the two `crew-e2e.*` request IDs above. The
`fixture.e2e.team-event.<platform>.*.v1` IDs belong only to the service/API
fixture and must not be substituted into a native build or trace claim.

## Hard preconditions

1. Finish both Golf orientations first. While the Golf runner is still alive,
   use the real Events logout UI on both devices and reach
   `private-access-signed-out`.
2. Stop only the exact Golf runtime with its PID-validated stop script. Start a
   fresh isolated Team runtime and run `control setup team-event` once. A runner
   that already completed `golf-tour` cannot be reused for setup.
3. Keep Metro `8082`, Android reverse mappings for `8082` and `3000`, Android
   font scale `1.0`, and the current signed debug builds. Never touch `8081`.
4. Never clear app data, clear a keychain, uninstall, reinstall or use an
   ambiguous booted iOS target.
5. Name the fresh credential-safe wrapper path locally, for example:

   ```sh
   TEAM_CONTROL=/absolute/path/to/the/fresh/team-runtime/control
   ```

   The wrapper may print only sanitized status, setup, trace and redemption
   results. It must never print its bearer files or a consumed token.

## Shared commands

Maestro:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  /Users/mathias/.maestro/bin/maestro test --device <exact-device> <flow>
```

iOS terminate/relaunch, always exact and never through a generic booted target:

```sh
/usr/bin/xcrun simctl terminate \
  F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3 app.crew.next
/usr/bin/xcrun simctl launch \
  F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3 app.crew.next \
  -RCT_jsLocation localhost:8082
```

Oracle deep links:

```sh
/usr/bin/xcrun simctl openurl \
  F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3 \
  crewnext://e2e/outbox/evt_local_team_day_2026

/opt/homebrew/share/android-commandlinetools/platform-tools/adb \
  -s emulator-5554 shell am start -W \
  -a android.intent.action.VIEW \
  -d crewnext://e2e/outbox/evt_local_team_day_2026 \
  -p app.crew.next
```

## Orientation A: Android participant, iOS owner

### 1. Authenticate without exposing the link

1. Run `40-team-participant-magic-request.yaml` on Android.
2. Redeem only through the wrapper:

   ```sh
   PATH=/opt/homebrew/share/android-commandlinetools/platform-tools:/usr/bin:/bin:/usr/sbin:/sbin \
     "$TEAM_CONTROL" redeem-android crew.team.participant.local@example.test
   ```

3. Run `41-team-owner-magic-request.yaml` on the already correctly launched iOS
   app, then:

   ```sh
   "$TEAM_CONTROL" redeem-ios crew.team.local@example.test
   ```

4. Both devices must reach `events-view`. Do not record the link or any token.

### 2. Bootstrap, detach and queue exactly one entry

1. Run `20-team-participant-bootstrap.yaml` on Android.
2. Establish a clean trace boundary and detach:

   ```sh
   "$TEAM_CONTROL" traces clear
   "$TEAM_CONTROL" allow crew-e2e.android
   "$TEAM_CONTROL" detach
   "$TEAM_CONTROL" status
   ```

   Expected status: transport `detached`, fault `idle`, traces `0`.

3. Run `21-team-participant-queue.yaml` once. Do not tap submit manually again.
4. Capture the queued Team feed at `412x915`, then open the Oracle and capture:

   - pending `1`, attention `0`, truncated `NEIN`;
   - exactly one `feed.entry.create` row in `PENDING`;
   - its command-body fingerprint and current cursor fingerprint;
   - request-body/idempotency fingerprints as shown (`—` is valid before the
     first attempted push).

5. `control traces` may now contain transport-detached attempts, but every one
   must have request ID `crew-e2e.android`, facade `503`, downstream `null` and
   replayed `false`. This proves zero downstream Gateway calls while detached.

### 3. Prove restart persistence

1. Run `21a-team-android-participant-after-relaunch.yaml`. Its `launchApp` stops
   and relaunches without clearing state.
2. Reopen the Oracle. Pending count, mutation kind, client sequence,
   command-body fingerprint and cursor fingerprint must exactly match the first
   Oracle capture. The message must still be visible once as locally saved.
3. Additional detached traces caused by route refresh are allowed. They must all
   retain the same request-body and idempotency fingerprints within this row.

### 4. Lose one committed response, then replay

1. Arm only the Android request ID, then attach:

   ```sh
   "$TEAM_CONTROL" fault crew-e2e.android
   "$TEAM_CONTROL" attach
   ```

2. Record the current trace count. Run
   `21b-team-participant-fault-retained.yaml` once.
3. Trace count must increase by exactly one. The last trace must be
   `success-suppressed`, downstream `200`, facade `503`, replayed `false`.
4. Reopen the Oracle. Pending remains `1`; request-body and idempotency
   fingerprints are now present and match the runner trace.
5. Record the trace count again. Run `22-team-participant-converged.yaml` once.
6. Trace count must increase by exactly one. The last trace must be `forwarded`,
   downstream/facade `200`, replayed `true`, with the exact same request-body and
   idempotency fingerprints as the suppressed request.
7. The Team feed shows `SYNCHRONISIERT`. The Oracle shows pending `0`, attention
   `0`; retain the delivered-empty capture and the new cursor fingerprint.

### 5. Independent owner readback

Run `23-team-owner-readback.yaml` on iOS. It forces an Event Hub refresh and
must show the exact Orientation-A body as a converged entry. Capture at
`390x844`.

## Switch roles using only the real UI

Keep the facade attached. Run:

- `28-team-android-logout-from-feed.yaml` on Android;
- `29-team-ios-logout-from-feed.yaml` on iOS.

Both flows must confirm the destructive alert and end at
`private-access-signed-out`. Do not clear state. This keeps the completed local
evidence account-scoped while making the role change explicit.

## Orientation B: iOS participant, Android owner

### 1. Authenticate the reversed devices

1. Run `40-team-participant-magic-request.yaml` on iOS and redeem with
   `"$TEAM_CONTROL" redeem-ios crew.team.participant.local@example.test`.
2. Run `41-team-owner-magic-request.yaml` on Android and redeem with:

   ```sh
   PATH=/opt/homebrew/share/android-commandlinetools/platform-tools:/usr/bin:/bin:/usr/sbin:/sbin \
     "$TEAM_CONTROL" redeem-android crew.team.local@example.test
   ```

3. Run `20-team-participant-bootstrap.yaml` on iOS.

### 2. Queue and restart

1. Clear/allow/detach with the iOS request ID:

   ```sh
   "$TEAM_CONTROL" traces clear
   "$TEAM_CONTROL" allow crew-e2e.ios
   "$TEAM_CONTROL" detach
   ```

2. Run `24-team-ios-participant-queue.yaml` once and capture the exact distinct
   Orientation-B body plus the pending Oracle.
3. Terminate/relaunch iOS with the exact two `simctl` commands above. Do not use
   Maestro `launchApp` for this restart because the app must retain the explicit
   `8082` React Native location.
4. Run `24a-team-ios-participant-after-relaunch.yaml`, then recapture the Oracle.
   Pending count, row, command-body and cursor fingerprints must match the
   pre-restart capture exactly.

### 3. Suppress, replay and read back

1. Run:

   ```sh
   "$TEAM_CONTROL" fault crew-e2e.ios
   "$TEAM_CONTROL" attach
   ```

2. Run `21b-team-participant-fault-retained.yaml` once. The next trace is the
   single `success-suppressed` `200 -> 503` record; Oracle remains pending.
3. Run `22-team-participant-converged.yaml` once. The next trace is the single
   forwarded `200`, replayed `true` record with identical fingerprints; Oracle
   becomes empty.
4. Run `25-team-android-owner-readback.yaml`. Android must independently show
   `iOS participant reconnect check: orientation B is ready.` as converged.

The trace shape is identical to Orientation A except for request ID and hashes.
Hashes must be identical within an orientation and different between the two
distinct messages/orientations.

## Authoritative exactly-once readback

The owner UI is required. If an exact server count is also retained, query only
the fresh isolated Team event test database with read-only mode enabled. Run the
same predicate once per exact body, substituting only the participant user ID
returned by setup:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT count(*)::int AS row_count,
       min(current.version)::int AS min_version,
       max(current.version)::int AS max_version
FROM event_feed_entries AS entry
JOIN event_feed_entry_current AS current
  ON current.root_event_id = entry.root_event_id
 AND current.entry_id = entry.id
WHERE entry.root_event_id = 'evt_local_team_day_2026'
  AND entry.event_id IS NULL
  AND entry.author_user_id = '<setup-participant-user-id>'
  AND entry.kind = 'message'
  AND current.deleted_at IS NULL
  AND current.body = '<one exact orientation body>';
ROLLBACK;
```

Expected for each body: `row_count=1`, `min_version=1`, `max_version=1`. Never
query a production database or mutate a service database directly.

## Pass/fail checklist

Each orientation passes only when all are true:

- one UI submit produced one persistent local outbox row;
- the row and fingerprints survived a real app restart;
- detached attempts never reached the downstream Gateway;
- exactly one committed response was suppressed;
- exactly one identical replay returned `idempotency-replayed=true`;
- participant pull emptied the outbox and changed the cursor fingerprint;
- the opposite-device owner independently read the exact body;
- optional read-only server proof returns one version-1 row for that body;
- all screenshots use `390x844` on iOS and `412x915` on Android;
- no token, link, bearer, raw request body, raw idempotency key or raw cursor was
  retained.

After both rows and evidence notes are complete, use the same real UI logout
flows, then stop only the exact Team runtime and verify its owned processes and
isolated stores are absent. Keep the matrix Bead open until that cleanup and
the final test gates are recorded.
