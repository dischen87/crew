# Dual-user offline fixture plan

This is the reproducible service/API harness and native handoff plan for the
participant disconnect and reconnect path. The service/API cases prove gateway
routing, authorization, replay and convergence. They do not prove native iOS or
Android persistence, a real connectivity transition, or app restart durability.

## Coverage matrix

| Scenario | Platform | Service/API status | Native status | Device ID | Mutation ID | Queued intent |
| --- | --- | --- | --- | --- | --- | --- |
| Turkey Golf | iOS | Default integration case | Required | `dvc_00000000-0000-4000-8000-000000007201` | `00000000-0000-4000-8000-000000007201` | `golf.score.set` |
| Turkey Golf | Android | Selectable integration case | Required | `dvc_00000000-0000-4000-8000-000000007202` | `00000000-0000-4000-8000-000000007202` | `golf.score.set` |
| Team Event | iOS | Selectable integration case | Required | `dvc_00000000-0000-4000-8000-000000007301` | `00000000-0000-4000-8000-000000007301` | `feed.entry.create` |
| Team Event | Android | Default integration case | Required | `dvc_00000000-0000-4000-8000-000000007302` | `00000000-0000-4000-8000-000000007302` | `feed.entry.create` |

`fixtureOfflineFlows` in `infra/bootstrap-fixture.ts` is the source of truth for
the service/API IDs and payloads. The Golf entity ID replaces
`<participant-user-id>` with the authenticated participant's user ID at runtime.
These logical sync IDs are not physical device identifiers or native evidence.
A native runner must either inject them through a separately reviewed
evidence-only seam or retain its actual sanitized IDs and label the difference.

## Fixture modes

Leaving `CREW_FIXTURE_OFFLINE_PLATFORM` unset preserves the default cases in the
table. Set it to `ios` or `android` to run the selected service/API replay case.
Set it to `none` to prepare the published event, memberships, roster and agenda
without applying the participant score or feed mutation. Native evidence must
start from this setup-only state.

```text
CREW_FIXTURE_SCENARIO=golf-tour
CREW_FIXTURE_OFFLINE_PLATFORM=none
```

The fixture returns user and event identifiers only. Access tokens, magic links
and invitation tokens stay inside the process and are never logged by the normal
CLI summary.

## Service/API replay phases

The service/API case authenticates an owner and participant through the gateway,
redeems the participant's invitation, and then performs these online calls:

1. `sync/bootstrap` and retain the participant cursor.
2. `sync/push` with the descriptor device and mutation IDs.
3. Replay the identical request with the same idempotency key and a distinct
   request ID. The owning service must return the byte-identical applied result
   without a duplicate write.
4. `sync/pull` from the saved cursor and have the owner read through the gateway.

The `queue.intent` descriptor is the planned native offline action. The
service/API fixture does not disconnect a device or write a native SQLite
outbox, so it cannot close the native offline acceptance criterion.

Online request IDs follow this exact pattern:

```text
fixture.e2e.<golf-tour|team-event>.<ios|android>.bootstrap.v1
fixture.e2e.<golf-tour|team-event>.<ios|android>.push.v1
fixture.e2e.<golf-tour|team-event>.<ios|android>.push.replay.v1
fixture.e2e.<golf-tour|team-event>.<ios|android>.pull.v1
```

For each online phase, retain sanitized evidence containing only the gateway
path, sent request ID, echoed `X-Request-ID`, owning-service path, and owning-
service request ID. Never retain access tokens, magic links, email addresses,
headers, or request bodies.

## Isolated native rows and guarded teardown

Run each matrix row in its own fresh, explicitly named local stack. Use setup-
only mode, sign in the owner and participant on the named platform, and never
reuse a stack between rows. For example, reserve the exact Compose project name
`crew-native-golf-ios`; inspect its containers and labeled volumes before use,
and refuse to continue if that project name already belongs to another run.

After evidence is retained, stop and remove only that exact project:

```text
docker compose -p crew-native-golf-ios down --volumes --remove-orphans
docker volume ls --filter label=com.docker.compose.project=crew-native-golf-ios
```

The second command must return no project volumes. Never use a volume prune,
wildcard database drop, production reset endpoint, or direct cross-service data
mutation. PostgreSQL integration runs may use only loopback databases accepted
by `assertFixtureTestDatabaseUrl`; the caller creates and drops those exact test
databases and verifies their absence. The fixture never drops caller-provided
databases.

## Native evidence still required

For each of the four rows:

1. While online, bootstrap and persist the participant cursor locally.
2. Disconnect the participant, queue exactly one intent in the production local
   outbox, and prove the gateway request count does not change.
3. If restart durability is in scope, terminate and relaunch before reconnecting.
4. Reconnect, push once, replay once, and pull from the saved cursor.
5. Have the owner independently read the participant's score or authored feed
   entry through the gateway.

Capture the participant UI before disconnect, while queued, and after
convergence; the owner's readback; local outbox state; and sanitized gateway and
owning-service request-ID traces. The row passes only when the offline phase made
zero requests, one domain object exists after replay, participant pull converges,
and owner readback matches. All domain mutations remain gateway-only; direct SQL
is limited to guarded test setup and final readback.
