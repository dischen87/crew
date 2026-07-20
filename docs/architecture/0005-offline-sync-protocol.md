# ADR-005: Offline sync and conflict protocol

- Status: Accepted
- Date: 2026-07-18
- Beads: `crew-paq.1.5`, `crew-paq.2.8`, `crew-paq.7.3`
- Depends on: [ADR-002](./0002-api-contract-standard.md),
  [ADR-003](./0003-event-domain.md)

## Context

Crew must remain useful through a flight, on a golf course, or at an offsite
with poor connectivity. A participant must be able to open a previously synced
event and queue an allowed change without waiting for the network. Reconnecting
must not duplicate a post, silently overwrite an organizer's edit, resurrect a
deleted itinerary item, or lose a photo whose upload only partly completed.

ADR-003 makes a root event the authorization and revision boundary. It gives
editable entities versions and every committed transaction a monotonic root
revision. This ADR defines the mobile and HTTP protocol that uses those
primitives. It does not introduce a second sync service or a generic CRDT.

## Decision

The mobile app is local-first:

- SQLite is the only source read by screens after sign-in. Network responses
  first commit to SQLite and then notify observers.
- An offline-capable write changes the local projection and inserts an outbox
  mutation in one SQLite transaction.
- The event service remains the canonical authority. It authenticates,
  authorizes, deduplicates, versions, and orders every accepted mutation.
- Push orders one device's mutations for one root. Pull distributes the total
  order of committed root changes to every authorized device.
- Conflicting editable state is never resolved with last-write-wins. Safe
  append-only facts merge; stale edits become visible dead letters.
- Binary attachments use a two-phase upload. Sync messages carry metadata and
  references, never binary data or local file paths.

The public gateway exposes these event-service operations unchanged in
semantics:

```text
POST /core/v1/sync/push
GET  /core/v1/sync/pull
GET  /core/v1/sync/bootstrap
POST /core/v1/event-roots/{rootEventId}/attachments/uploads
```

They follow ADR-002: code-first OpenAPI 3.1, explicit bearer security,
`X-Request-ID`, strict request objects, the shared HTTP error envelope, and
generated clients. Mobile never calls the event service directly.

## Mobile SQLite contract

SQLite runs with foreign keys enabled and WAL journaling. Its minimum logical
records are:

| Record | Purpose |
|---|---|
| root sync state | `rootEventId`, current pull cursor, snapshot ID/revision, authorization-scope version, and last completed sync time |
| server read models | normalized events, memberships, itinerary, capabilities, feed, feedback, places, golf round/own score/leaderboard, and attachment metadata last confirmed by pull/bootstrap |
| mutation outbox | immutable command envelope, payload fingerprint, optimistic overlay, state, attempts, next attempt, and last safe error |
| local attachment | attachment ID, local URI, checksum, byte count, upload lease, and transfer state; local URI never leaves the device |

An implementation may materialize optimistic views for speed, but the
recoverable model is always **server read model plus ordered pending overlays**.
This lets the app remove or rebase one rejected overlay without guessing the
previous server value. Outbox payloads are immutable after enqueue; a user
retry after editing creates a new mutation.

The transaction for a local write:

1. reads the next sequence for the root stream;
2. inserts one immutable outbox mutation;
3. applies its optimistic overlay or materialized projection; and
4. advances the local next sequence.

If any step fails, none commits. Screens continue to query SQLite while push,
pull, and attachment transfer run in the background. A query cache may notify
or memoize, but it is not another source of truth.

### Outbox identity and states

`clientMutationId` is a lowercase UUID generated once with
`crypto.randomUUID()` and retained across every retry. The event service
deduplicates it by authenticated user across all roots. `deviceId` is a
lowercase `dvc_<uuid>` installation identifier, not an identity or an
authorization claim. `clientSequence` is a positive safe JSON integer no larger
than `Number.MAX_SAFE_INTEGER - 1`, allocated without gaps per
`(user, deviceId, rootEventId)` stream.

The local state machine is:

```text
pending -> sending -> awaiting_pull -> removed
                  \-> pending          (retryable transport/server failure)
                  \-> dead_letter      (terminal mutation result)
pending -> blocked                     (an earlier sequence needs attention)
blocked -> pending                      (after reconciliation)
dead_letter -> removed | new mutation  (explicit user resolution)
```

An applied mutation remains as an `awaiting_pull` overlay until a pull commits
through its returned root revision. Removing it earlier could briefly revert
the UI to stale server state. Dead letters preserve the proposed change and a
safe reason until the user discards it or creates a replacement.

Only one push may be in flight for a local root stream. Push and pull may run
concurrently because pull is ordered by server root revision, not client
sequence.

## Mutation push contract

`POST /core/v1/sync/push` has operation ID `syncMutationsApply`. It requires a
user bearer token and an `Idempotency-Key`. One request contains 1..100 mutations
from exactly one `deviceId` and `rootEventId`, with a maximum decoded body of
1 MiB. The byte limit is enforced while streaming, before JSON parsing and
before claiming HTTP idempotency. Request order has no meaning; the service
sorts by `clientSequence`.

Each mutation has:

| Field | Rule |
|---|---|
| `clientMutationId` | Required UUID, stable forever for this logical attempt |
| `clientSequence` | Required positive safe integer in the device/root stream |
| `kind` | Closed operation discriminator with its own strict payload schema |
| `entityId` | Client-issued opaque ID for create, existing ID otherwise |
| `baseVersion` | Required for edit, reorder, and delete; absent for creates and naturally idempotent facts |
| `payload` | Strict command input, never a whole client database row |

The batch request is valid JSON and can be saved as a contract-test fixture:

```json
{
  "protocolVersion": 1,
  "rootEventId": "evt_belek",
  "deviceId": "dvc_7d641cf7-108c-4f70-a2d7-bd8f4305e1fe",
  "mutations": [
    {
      "clientMutationId": "11e8a3da-f9f1-4d43-ae22-0465bebad99d",
      "clientSequence": 42,
      "kind": "itinerary.update",
      "entityId": "iti_tee_1",
      "baseVersion": 3,
      "payload": {
        "changes": {
          "title": "Tee time - Montgomerie Maxx Royal",
          "startsAt": "2026-10-12T06:10:00Z",
          "timeZone": "Europe/Istanbul"
        }
      }
    },
    {
      "clientMutationId": "60f26d88-c16d-45b7-9bb0-d799b929f94c",
      "clientSequence": 43,
      "kind": "feed.entry.create",
      "entityId": "fed_019f7410",
      "payload": {
        "eventId": "evt_belek_round_1",
        "parentEntryId": null,
        "kind": "message",
        "content": "Meet in the lobby at 07:30."
      }
    }
  ]
}
```

The client sends a new HTTP `Idempotency-Key` for a new batch and reuses that
key only while retrying the same HTTP request. Per-mutation IDs are the durable
deduplication boundary when a later batch overlaps an earlier one.

### Server processing and atomicity

After validating the envelope and bearer token, the event service deliberately
conceals an absent or non-visible root, including a removed membership, with
`404 NOT_FOUND`. A visible member's command permissions are still evaluated per
mutation. The service processes the sorted contiguous sequence in one bounded
database transaction:

1. Take actor-global mutation-ID advisory locks in sorted order, then lock the
   stream row for `(userId, deviceId, rootEventId)`.
2. Look up `clientMutationId` before checking sequence. A matching fingerprint
   returns the stored outcome with `replayed: true`. A different fingerprint
   returns `IDEMPOTENCY_KEY_REUSED` and performs no domain work.
3. Require the next unrecorded mutation to equal the stream's expected
   sequence. A higher number is `CAUSAL_GAP`; a consumed sequence occupied by a
   different mutation ID is `SEQUENCE_REUSED`.
4. Validate the kind-specific payload and authorize the command against the
   current membership and domain state. Authority is reevaluated after every
   preceding mutation in the batch.
5. Apply the command using its `baseVersion` when required. In the same
   transaction, allocate the root revision, append change rows and outbox
   events, store the mutation fingerprint/result, and advance the stream.
6. A terminal validation, authorization, business-rule, or version rejection
   stores the rejection and advances the sequence, but writes no domain change
   and allocates no root revision. Processing stops so dependent later
   mutations are returned as `blocked`.
7. A temporary domain precondition such as pending attachment scanning returns
   `retry`, consumes no sequence, and stops the batch. A successfully processed
   prefix may commit; the client uses a new HTTP idempotency key when retrying
   the remaining batch after the response.
8. A retryable database or unexpected service failure rolls back the whole
   transaction and returns the normal HTTP `503`/`500` error envelope. No
   mutation or sequence is partly recorded.

The fingerprint is SHA-256 over the protocol version, actor, root, device,
sequence, kind, entity ID, base version, and canonical JSON payload. Mutation
receipts are retained for the lifetime of the root, so compaction cannot turn
an old retry into a new write. Reusing one mutation UUID in another root is
therefore rejected rather than applied twice. The HTTP idempotency record
follows ADR-002 and stores the completed batch response in the same transaction.

For a syntactically valid, visible root, per-mutation domain outcomes use HTTP
`200`; a mixed batch does not use WebDAV `207`. Each item contains its logical
status. Envelope/authentication failures use the ordinary ADR-002 HTTP status
and error envelope.

Example response:

```json
{
  "protocolVersion": 1,
  "rootEventId": "evt_belek",
  "deviceId": "dvc_7d641cf7-108c-4f70-a2d7-bd8f4305e1fe",
  "results": [
    {
      "clientMutationId": "11e8a3da-f9f1-4d43-ae22-0465bebad99d",
      "clientSequence": 42,
      "outcome": "applied",
      "replayed": false,
      "rootRevision": "1842",
      "entity": {
        "entityType": "itineraryItem",
        "entityId": "iti_tee_1",
        "version": 4
      }
    },
    {
      "clientMutationId": "60f26d88-c16d-45b7-9bb0-d799b929f94c",
      "clientSequence": 43,
      "outcome": "rejected",
      "replayed": false,
      "error": {
        "code": "FORBIDDEN",
        "message": "Your current event role cannot post this entry.",
        "retryable": false
      }
    }
  ],
  "nextExpectedClientSequence": 44
}
```

Valid outcomes are:

| Outcome | Persisted | Meaning |
|---|:---:|---|
| `applied` | yes | Domain change and mutation receipt committed |
| `rejected` | yes for an in-sequence terminal decision | No domain change; client moves it to dead letter |
| `retry` | no | Temporary condition; retry the unchanged mutation after the stated delay |
| `blocked` | no | A gap or earlier rejected/retryable mutation must be handled first |

A duplicate is the original `applied` or `rejected` outcome with
`replayed: true`, not a fifth outcome. This preserves the original entity
identity, version, root revision, and error. `retry` and `blocked` items carry
the same safe `{ code, message, retryable }` shape and may include
`retryAfterSeconds`.

### Ordering and duplicate rules

- Reordered items within a batch are sorted and processed normally.
- A sequence gap processes no item after the gap and returns the expected
  sequence. The client resends from that sequence.
- A repeated mutation ID with the same fingerprint cannot duplicate domain or
  feed state, even under concurrent requests.
- A mutation ID reused with different content is terminal misuse and never
  changes the stored result.
- A client sequence reused by a different mutation is terminal local
  corruption. The client preserves it as a dead letter and creates no
  replacement in that stream slot.
- Different devices have independent client streams. Their accepted changes
  join one total server order through `rootRevision`; ordinary entity versions
  detect conflicting edits between them.
- Client timestamps never order writes and never override server timestamps.

## Merge and conflict rules

Mutation kinds are not generic JSON Patch. Each kind declares whether it is an
append, a naturally idempotent fact, or an editable-state command.

### Safe merge without a base version

- `feed.entry.create` appends a client-ID-addressed entry. The same ID and body
  is a replay; the same ID with different content is `ID_COLLISION`.
- `feed.reaction.set` upserts the fact `(entryId, userId, reaction)` to its
  requested present/absent state.
- Other growing collections may use the same pattern only with a database
  uniqueness constraint and a documented deterministic identity.

Concurrent appends receive different root revisions and both appear. Feed
edits create `feed.entry.revise` records referencing the previous revision;
removals append a tombstone. They do not mutate published history in place.

### Editable state

Updates, deletes, capability replacements, feed revisions, and reorder commands
carry the observed `baseVersion`. A match applies and increments once. A stale
base returns `VERSION_CONFLICT` with `currentVersion` and, only when the caller
may read it, the safe current representation. It never overwrites the server
value automatically.

The app moves the proposal to dead letter, commits a pull, and shows the user
the server value and their preserved proposal. “Apply mine” creates a new UUID,
new sequence, and current base version. “Keep current” removes the proposal.
There is no hidden force flag in v1.

### Golf round and score state

`golf.round.replace` is the manager-only setup mutation in the existing
`syncMutationsApply` stream. The authenticated owner or organizer supplies the
event ID, exactly 18 unique holes and stroke indices, eligible active
non-viewer players with signed playing handicaps, and up to 50 teams with at
most four unique eligible players each. `entityId` must equal the payload event
ID, while the root always comes from the authenticated sync envelope. A first
round uses `baseVersion: 0`; replacements use the observed positive round
version. Exact and semantic retries are no-ops, while stale changes return the
authoritative `currentVersion`. Before either a stored mutation receipt or an
HTTP idempotency response can replay as applied, the server rechecks the
current active root, manager role, writable event, and Golf capability. The
mutation emits member-visible `golfRound`/`golfLeaderboard`, a manager-only
`golfRoster` with the full signed-handicap player list, and actor-scoped
`golfPlayer` projections through the same bootstrap/pull contract. Participants
never receive another player's handicap. Removing a player from the round emits
an actor-scoped `golfPlayer` tombstone; demotion to viewer emits the same cleanup
signal and viewer bootstrap never rematerializes the player or their private
scores.

`golf.score.set` is an editable-state mutation inside the existing
`syncMutationsApply` stream; it is not a second endpoint or sender. Its strict
wire input is:

```json
{
  "clientMutationId": "5e3c06a6-899c-47b3-9bf0-c644ca6f9284",
  "clientSequence": 44,
  "kind": "golf.score.set",
  "entityId": "gsc_evt_belek_round_1:usr_0123456789abcdef0123456789abcdef:1",
  "baseVersion": 0,
  "payload": {
    "eventId": "evt_belek_round_1",
    "hole": 1,
    "strokes": 4,
    "putts": 2
  }
}
```

The server derives the player from the authenticated actor and reads the
playing handicap, par, and stroke index from the authoritative round. Client
payloads cannot name a user or submit handicap, net score, or Stableford
points. A first score uses `baseVersion: 0`; edits use the last confirmed
positive version. A score write emits the actor-only `golfScore` change and the
member-visible `golfLeaderboard` change at the same root revision. Bootstrap
and pull also expose `golfRound`, the current actor's `golfPlayer`, the current
actor's `golfScore` records, and the shared `golfLeaderboard` projection.
An applied score receipt or HTTP response is replayable only while the actor is
still an active non-viewer round player and the authoritative published round
remains open.

Mobile links each immutable golf intent to exactly one `mutation_outbox` row in
the same SQLite transaction. The outbox allocates the only wire
`clientSequence`; the intent's local sequence is projection order only and is
never a second transport stream. Applied ACK and pull may arrive in either
order, but the intent converges only after both the acknowledged score version
and authoritative pulled projection are present. SQLite schema v11 stores
`golfPlayer` tombstones and removes only the current account's self-player,
dependent scores and local score intents. It retains the linked outbox command
until the server consumes its sequence, so player removal cannot create a wire
gap; delayed stale player upserts cannot resurrect the projection.

The score mutation assumes that an owner or organizer has first applied the
authoritative round through `golf.round.replace`. Fixtures must build that
round through the Gateway contract before participants submit scores; direct
event-database setup is not valid transport evidence.

An update against a tombstone returns `ENTITY_DELETED`; it cannot resurrect the
ID. Reorder payloads contain the observed collection version plus adjacent
sibling IDs. A stale reorder returns `VERSION_CONFLICT` and the authoritative
ordered IDs, never duplicate or guessed sort keys.

## Change pull contract

`GET /core/v1/sync/pull` has operation ID `syncChangesList` and accepts one
`rootEventId`, required opaque `cursor`, and `limit` from 1..200 (default 50).
The cursor's logical position is monotonic `(rootRevision, ordinal)`, but its
wire value is opaque, signed, and versioned. It is bound to operation, root,
authenticated user, authorization-scope version, and contract major. Clients
store and return it verbatim; they never parse or compare it.

Changes are strictly ascending by `(rootRevision, ordinal)`. All changes from
one event-service transaction share a revision and have stable ordinals. A
record contains either a canonical upsert representation or a minimal
tombstone, never both.

```json
{
  "protocolVersion": 1,
  "rootEventId": "evt_belek",
  "authorizationScopeVersion": "7",
  "changes": [
    {
      "rootRevision": "1842",
      "ordinal": 0,
      "entityType": "feedEntry",
      "entityId": "fed_019f7410",
      "operation": "upsert",
      "entityVersion": 1,
      "data": {
        "id": "fed_019f7410",
        "rootEventId": "evt_belek",
        "eventId": "evt_belek_round_1",
        "parentEntryId": null,
        "actorUserId": "usr_0123456789abcdef0123456789abcdef",
        "kind": "message",
        "payloadSchemaVersion": 1,
        "payload": {
          "text": "Meet in the lobby at 07:30."
        },
        "rootRevision": "1842",
        "createdRootRevision": "1842",
        "version": 1,
        "createdAt": "2026-07-18T12:29:00.000Z",
        "updatedAt": "2026-07-18T12:29:00.000Z",
        "deletedAt": null
      }
    },
    {
      "rootRevision": "1843",
      "ordinal": 0,
      "entityType": "feedEntry",
      "entityId": "fed_old_notice",
      "operation": "tombstone",
      "entityVersion": 2,
      "tombstone": {
        "id": "fed_old_notice",
        "rootEventId": "evt_belek",
        "eventId": "evt_belek_day_1",
        "deletedAt": "2026-07-18T12:30:00Z",
        "version": 2
      }
    }
  ],
  "checkpointCursor": "eyJ2IjoxLCJyb290IjoiZXZ0X2JlbGVrIiwicG9zIjoiMTg0MzowIn0.sig",
  "pageInfo": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

`checkpointCursor` is the durable position after the last scanned change and is
always returned. To satisfy ADR-002 collection pagination,
`pageInfo.nextCursor` is non-null only when another page is immediately
available; when present it equals `checkpointCursor`. The next poll uses the
latest `checkpointCursor`, including when `hasMore` is false.

The app applies the entire page and checkpoint in one SQLite transaction. An
upsert or tombstone whose `(rootRevision, ordinal)` was already applied is a
no-op. A newer tombstone removes the server read model and its media reference,
but never silently deletes a local pending proposal. After applying the page,
the app rebuilds affected optimistic projections. It removes `awaiting_pull`
overlays whose applied revision is now covered by the checkpoint.

A malformed, tampered, wrong-root, or wrong-principal cursor returns
`400 CURSOR_INVALID`. A cursor older than retained change history or bound to an
obsolete authorization scope returns `410 CURSOR_EXPIRED` with the shared error
envelope and a safe bootstrap path:

```json
{
  "error": {
    "code": "CURSOR_EXPIRED",
    "message": "A new event snapshot is required.",
    "requestId": "63f340e3-868e-4732-8f0f-332381e4b647",
    "retryable": false,
    "details": [
      {
        "code": "BOOTSTRAP_REQUIRED",
        "message": "Restart sync from the current event snapshot.",
        "meta": {
          "bootstrapPath": "/core/v1/sync/bootstrap?rootEventId=evt_belek"
        }
      }
    ]
  }
}
```

## Snapshot bootstrap and reset

`GET /core/v1/sync/bootstrap` has operation ID `syncBootstrapRead`. It returns
an immutable, point-in-time snapshot in pages. The first request supplies
`rootEventId` and `limit`; later pages also supply the opaque pagination
`cursor`.
Every page repeats `snapshotId`, `snapshotRevision`, and `syncCursor`. The
cursor starts pull immediately after the snapshot revision.

```json
{
  "protocolVersion": 1,
  "rootEventId": "evt_belek",
  "authorizationScopeVersion": "7",
  "snapshotId": "snp_019f745b",
  "snapshotRevision": "1840",
  "records": [
    {
      "entityType": "event",
      "entityId": "evt_belek",
      "entityVersion": 8,
      "data": {
        "id": "evt_belek",
        "rootEventId": "evt_belek",
        "parentEventId": null,
        "kind": "trip",
        "title": "Belek Golf Tour",
        "description": null,
        "timeZone": "Europe/Istanbul",
        "startsAt": "2026-10-11T08:00:00.000Z",
        "endsAt": "2026-10-18T18:00:00.000Z",
        "sortKey": "1024",
        "childOrderVersion": 3,
        "itineraryOrderVersion": 5,
        "status": "published",
        "version": 8,
        "createdAt": "2026-07-18T08:00:00.000Z",
        "updatedAt": "2026-07-18T12:00:00.000Z",
        "deletedAt": null
      }
    }
  ],
  "syncCursor": "eyJ2IjoxLCJyb290IjoiZXZ0X2JlbGVrIiwicG9zIjoiMTg0MDpFTkQifQ.sig",
  "pageInfo": {
    "nextCursor": "eyJ2IjoxLCJzbmFwc2hvdCI6InNucF8wMTlmNzQ1YiIsInBhZ2UiOjJ9.sig",
    "hasMore": true
  }
}
```

The service creates or reuses an immutable actor-scoped snapshot before
compacting any history it replaces. Snapshot page tokens are bound to the
actor, root, authorization-scope version and snapshot ID. Snapshots expire 15
minutes after creation using database time; an expired page token returns
`410 CURSOR_EXPIRED`, and a new page-one request builds one coherent replacement
rather than mixing snapshots.

Mobile never clears its live tables page by page. It writes all pages to
staging tables. After the final page, one SQLite transaction:

1. verifies every page used the same snapshot ID and revision;
2. swaps the root's staged server read models into place;
3. stores `syncCursor` and the authorization-scope version;
4. reapplies still-pending optimistic overlays in client-sequence order; and
5. moves proposals that no longer validate to dead letter without losing their
   payload.

A crash before the swap leaves the prior readable root and cursor intact. A
successful reset does not discard the outbox. If access to the root was removed,
the server returns concealed `404`; the app stops sync and securely removes the
root's server data according to the account-data policy while retaining no
private content for another signed-in user.

## Two-phase attachments

SQLite stores a local URI and checksum separately from the mutation JSON.
Before an attachment can be referenced by shared event state:

1. Mobile calls
   `POST /core/v1/event-roots/{rootEventId}/attachments/uploads` with an
   `Idempotency-Key`, client-issued attachment ID, target feed-entry ID, byte
   count, supported MIME type, and SHA-256 checksum. The service authorizes the
   target and returns an upload ID, bounded signed POST fields, and expiry.
2. Mobile uploads bytes directly to the private quarantine bucket and then
   calls the upload's `/finalize` route. Finalize durably enqueues one fenced
   verification job; workers validate exact bytes/container/decode and copy a
   verified object to a separate committed key. Mobile polls finalize using
   the same idempotency key until it reports verified. It may request a new
   lease for the same attachment ID and checksum after expiry.
3. Mobile enqueues `attachment.commit` in the normal root stream only after
   verification. Its strict payload contains the upload ID and optional
   caption; target, checksum, byte count and MIME type come from the immutable
   upload record. The event service then commits attachment metadata, root
   change, notification outbox work, and mutation receipt atomically without
   repeating object I/O.

Upload preparation fixture:

```json
{
  "attachmentId": "att_019f7462",
  "targetEntryId": "fed_trip_gallery",
  "contentType": "image/jpeg",
  "byteCount": 1843200,
  "sha256": "7ae3e2a4f909b53a0f6e89b3ee6d67dd631224881a3f7f402f5dd84f8fcaef3b"
}
```

Commit mutation fixture:

```json
{
  "clientMutationId": "e570b427-0e76-4c61-a7a0-10718e9faaf4",
  "clientSequence": 44,
  "kind": "attachment.commit",
  "entityId": "att_019f7462",
  "payload": {
    "uploadId": "upl_019f7465",
    "caption": "First tee"
  }
}
```

An unverified, expired, mismatched, infected, or oversized upload cannot commit.
Retryable scanning/processing returns `retry`; a permanent mismatch returns a
terminal rejection. Uncommitted objects are quarantined and deleted after at
least 24 hours. Committed objects are never deleted by lease cleanup. Pull and
bootstrap carry attachment metadata only; a separate authorized media request
issues short-lived download URLs. Cached bytes remain an explicit mobile cache.

## Retry, blocked work, and dead letters

The sync engine triggers on app foreground, connectivity restoration, a local
write, background opportunity, and explicit user retry. It never requires a
tight polling loop.

- Network errors, `408`, `429`, and retryable `5xx` use exponential backoff with
  full jitter: base 2 seconds, cap 15 minutes, honoring a longer
  `Retry-After`.
- A new app foreground may retry immediately if no request is already in
  flight. Connectivity status is only a hint; the HTTP result is authoritative.
- A terminal per-mutation result enters `dead_letter` immediately. Later
  sequences remain blocked until the app pulls and reconciles that proposal.
- After 20 consecutive retryable failures or seven days, whichever comes
  first, a mutation also enters dead letter so a visible “Needs attention”
  state replaces endless silent work. Manual retry resets attempts but keeps
  the same mutation ID and payload.
- Sign-out never sends one account's outbox under another account. Pending
  private state is encrypted at rest where platform protection requires it and
  is retained or removed only through an explicit account policy.

No outcome silently drops a mutation. Logs and analytics may contain IDs,
attempt counts, codes, and latency, but never message bodies, attachment bytes,
invite secrets, bearer tokens, or pre-signed URLs.

## History retention and compaction

The event service retains root change rows for at least 90 days. Retention is a
minimum, not a promise that every cursor remains valid exactly 90 days: a
cursor may also expire after an authorization-scope or contract-major change.

Compaction follows this order:

1. Capture a point-in-time root snapshot at revision `R`.
2. Verify its schema version, row counts, checksums, readability, and cursor at
   `R`.
3. Publish it for bootstrap before deleting any represented change row.
4. Advance the root's minimum pull position in one transaction.
5. Delete only sync change history at or below the safe boundary after the
   retention window.

Compaction never mutates canonical live rows, reuses an entity ID, drops
per-mutation receipts, or substitutes for the separate audit-retention policy.
Minimal tombstones remain in uncompacted change history; a fresh snapshot
simply omits already-deleted entities. Any client behind the new minimum gets
`410 CURSOR_EXPIRED` and performs the staging-table reset above.

## Required acceptance tests

The examples in this ADR are JSON fixtures validated against the code-first
schemas. Service integration tests run against real Postgres; mobile sync tests
run against a temporary real SQLite database.

### Push and ordering

- Queue a local projection plus outbox row, force a transaction failure, and
  prove neither commits; then prove screens read the committed SQLite state
  without a network cache.
- Submit sequences 43 then 42 in one JSON array and prove the service applies
  42 then 43. Submit 45 without 44 and prove it returns `CAUSAL_GAP` with no
  later mutation applied.
- Replay the same mutation concurrently, in another batch, and after a lost
  HTTP response; prove one domain effect and the identical stored result.
- Reuse a mutation ID with changed payload and a consumed sequence with a new
  ID; prove `IDEMPOTENCY_KEY_REUSED`/`SEQUENCE_REUSED` and no domain effect.
- Force failure after domain work but before receipt/outbox completion and
  prove domain row, revision, change log, mutation receipt, HTTP idempotency
  result, and outbox all roll back.
- Downgrade/remove membership between queued writes and push; prove each
  command uses current authority and a removed root is concealed.

### Conflict and merge

- Concurrently edit one itinerary item from two devices at the same base
  version; prove exactly one applies and the other preserves a
  `VERSION_CONFLICT` proposal without overwriting.
- Concurrently append two feed entries and set the same reaction; prove both
  entries survive, the reaction is one fact, and retries add no duplicates.
- Edit and remove a feed entry through revisions/tombstones; prove immutable
  published history and deterministic mobile replacement.
- Reorder siblings against matching and stale collection versions; prove the
  returned order has every ID once and a stale client receives the
  authoritative order.
- Apply update, deletion, duplicate tombstone, and stale resurrection attempts;
  prove SQLite converges and a deleted ID never returns.
- Interleave ordinary mutations and golf intents on one device/root, then prove
  one gap-free outbox sequence, exact golf replay, actor-only score privacy,
  same-revision leaderboard convergence, and ACK-before-pull plus
  pull-before-ACK convergence. A missing-score conflict may report
  `currentVersion: 0` without breaking the local outcome transaction.

### Pull, reset, and attachments

- Page changes while new revisions commit; prove every `(revision, ordinal)` is
  applied once in order and the checkpoint advances only with its SQLite
  transaction.
- Retry and reorder an already received page; prove idempotent upserts,
  tombstones, and removal of `awaiting_pull` only after its revision arrives.
- Expire a cursor, interrupt bootstrap on every page, and prove the old local
  root stays readable until one atomic snapshot swap; pending overlays survive
  or become visible dead letters.
- Compact history only after publishing a verified snapshot; prove an old
  cursor gets `410`, a current cursor continues, and both converge to the same
  root state.
- Expire an upload lease, retry upload preparation, corrupt bytes, fail malware
  scanning, lose the commit response, and run orphan cleanup; prove only one
  verified attachment commits and no committed object is deleted.
- Run the Turkey golf and team-event fixtures through bootstrap, offline edits,
  push, conflicts, pull, and a second device; prove the protocol has no
  golf-only or travel-only dependency.

Contract tests also validate every example against its strict request/response
schema, all declared error statuses and `X-Request-ID`, the 100-mutation/1-MiB
limits, cursor scope binding, and generated-client drift.

Package-level real-Postgres, generated Gateway/client, and real-SQLite evidence
completes the round-and-score transport gate within `crew-paq.7.3` and its
round-setup child `crew-paq.7.3.1`. Native two-user disconnect and reconnect
proof belongs to `crew-paq.7.4`; it does not substitute for these contract/data
gates and does not reopen them when the device harness is not yet run.

## Consequences

Crew gets deterministic offline behavior without a generic synchronization
platform: SQLite plus one outbox, per-device root streams, event-service
versions/revisions, and snapshots are sufficient. Duplicate and reordered
requests are safe, while edits that need human intent stay visible instead of
being guessed away.

The cost is explicit mutation schemas, durable receipts, snapshot production,
and careful projection tests. Cross-root atomic edits, arbitrary JSON Patch,
peer-to-peer sync, silent last-write-wins, and a general CRDT layer are not part
of v1. They should be added only for a measured requirement that this protocol
cannot satisfy.
