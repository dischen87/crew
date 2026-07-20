# ADR-003: Recursive event domain

- Status: Accepted
- Date: 2026-07-18
- Bead: `crew-paq.1.4`
- Depends on: [ADR-001](./0001-service-boundaries.md),
  [ADR-002](./0002-api-contract-standard.md)

## Context

Crew must represent a Turkey golf tour, one golf day, a team offsite, and one
session inside that offsite without inventing a separate hierarchy for every
product vertical. Organizers need to compose these experiences, while
participants need one predictable timeline, feed, invitation model, and
offline data boundary.

The legacy model is flat: an event belongs to a group and has no parent, root,
entity version, or tombstone. Copying that model would make nested itineraries,
root-scoped authorization, and deterministic offline sync unsafe.

## Decision

`event-service` owns one recursive event graph. Every event is either a root or
a descendant of exactly one root. The root is the authorization, sync,
revision, export, migration, and cutover boundary.

The graph is a domain aggregate, not one permanently loaded object and not a
promise that every root mutation uses one database row. Commands update the
smallest required rows in one local Postgres transaction and allocate a root
revision. Reads project the graph needed by the caller.

The base event stays deliberately small. Travel, lodging, transport, golf, and
team behavior are typed capabilities and itinerary details rather than nullable
columns on every event.

## Core records

### Event

| Field | Rule |
|---|---|
| `id` | Opaque, immutable `evt_*` identifier; never reused |
| `rootEventId` | Equals `id` for a root; otherwise equals the ancestor root |
| `parentEventId` | `null` for a root; a live event in the same root otherwise |
| `kind` | Presentation hint: `trip`, `day`, `golf`, `team_event`, `session`, `activity`, or `other` |
| `title`, `description` | Human content; description is optional rich text in the supported safe format |
| `timeZone` | Required IANA zone used for local display and date grouping |
| `startsAt`, `endsAt` | Optional UTC instants; if both exist, start is before end |
| `sortKey` | Server-issued decimal string ordered numerically among siblings; ID is the tie-breaker |
| `status` | `draft`, `published`, `cancelled`, or `archived` |
| `version` | Positive integer incremented on each editable-state change |
| `createdAt`, `updatedAt` | Server timestamps |
| `deletedAt` | Set only on a tombstone; absent on a live row |

`kind` drives sensible defaults and iconography, not authorization or storage
shape. A team event may use transport; a trip may contain a team session. Code
branches on attached capabilities, not on guessed implications of `kind`.

### Hierarchy invariants

The database and application service enforce all of these in the same
transaction:

1. A root has `parentEventId = null` and `rootEventId = id`.
2. A descendant has a non-null parent whose `rootEventId` equals its own.
3. An event cannot parent itself or any descendant. Reparenting locks the moved
   event and candidate parent, then checks ancestry with a recursive query.
4. A live event cannot have a deleted parent. Identifiers never move between
   roots; moving across roots is an explicit copy/archive product operation.
5. Sibling order is `(numeric sortKey ASC, id ASC)`. Reorder commands name the
   adjacent sibling IDs they observed; the server issues new keys and returns
   the authoritative order.
6. Archiving a parent preserves its descendants. Tombstoning an event with
   live descendants is rejected unless the command explicitly requests a
   subtree tombstone and the actor can manage the entire root.
7. A root contains at most 500 live events including the root, so every sibling
   collection remains reorderable. The domain imposes no product-specific depth
   limit; recursive queries remain bounded by one root.

Database constraints cover null/root consistency, time ordering, positive
versions, and unique IDs. Deferred constraint triggers or the command
transaction cover parent existence, same-root ancestry, and cycle prevention.
Negative integration tests are required because a TypeScript check alone is
not a durable invariant.

## Root membership and roles

Membership exists only at the root. Descendants inherit it; v1 has no hidden
child membership or per-child role override.

| Role | Meaning |
|---|---|
| `owner` | Exactly one active member; can transfer ownership and archive the root |
| `organizer` | Can manage the graph, itinerary, capabilities, invitations, and participant content moderation |
| `participant` | Can read published root content and create participant contributions allowed by a feature |
| `viewer` | Read-only access to published content; cannot post or mutate domain state |

A membership records `rootEventId`, global `userId`, role, status
(`active`, `left`, or `removed`), version, timestamps, and optional removal
actor/reason. The unique key is `(rootEventId, userId)`. A removed or left
membership is retained for audit and sync; rejoining changes its state and
version rather than creating ambiguous duplicates.

The event service derives the actor from a verified user-service token and
loads membership by root. It never accepts `userId`, membership, or role
headers as authority. Safe not-found responses conceal roots from
non-members. Owner transfer, organizer promotion, member removal, and root
archive write auditable domain events.

### Authorization matrix

| Action | Owner | Organizer | Participant | Viewer |
|---|:---:|:---:|:---:|:---:|
| Read published root/descendants | yes | yes | yes | yes |
| Read and edit drafts | yes | yes | no | no |
| Create, edit, reorder, cancel descendants | yes | yes | no | no |
| Configure capabilities and itinerary | yes | yes | no | no |
| Create participant-role invitations | yes | yes | no | no |
| Invite/promote an organizer | yes | no | no | no |
| Remove participants and moderate content | yes | yes | no | no |
| Post feed content/reactions | yes | yes | yes | no |
| Transfer ownership or archive root | yes | no | no | no |
| Edit/delete own permitted contribution | yes | yes | yes | no |

Feature-specific commands may narrow participant writes but cannot widen this
matrix. Service and worker identities do not become members; audited internal
commands state both machine caller and causating user/system action.

## Invitations

An invitation belongs to a root and grants at most `organizer`, `participant`,
or `viewer`. It contains an opaque ID, intended role, creator, optional
normalized email hint, expiry, maximum uses, use count, status, version, and a
hash of the secret token. Plain tokens are returned only at creation and never
stored or logged.

Invite preview is public but reveals only safe branding: root title, cover,
approximate date range, organizer display name, and whether the invite remains
usable. Redemption requires an authenticated global user and is one local
transaction that locks the invite, verifies expiry/revocation/use count, and
upserts membership. The command is idempotent for the same user. Revocation,
expiry, a different signed-in user where an email binding applies, and
concurrent last-use redemption have explicit tests.

An email-bound redemption accepts identity only from the user-service RS256
access token's normalized `email` claim when `email_verified` is exactly
`true`. A missing or mismatched claim rejects atomically without consuming an
invite use; caller-provided headers or request-body email never establish the
binding.

Once that actor has redeemed the invite, replay is keyed by the durable
redemption and remains successful even if a later token omits or changes the
email claim; replay never consumes another use.

Invitations never create user credentials. Sign-in/session issuance remains in
`user-service`; event membership remains in `event-service`.

## Itinerary and locations

An itinerary item belongs to exactly one event and therefore one root. It has
an opaque `iti_*` ID, event/root IDs, title, optional notes, local display zone,
optional start/end instants, all-day flag, `sortKey`, status, version,
timestamps, and optional origin/destination/place references.

Its `details` is a closed, versioned discriminated union validated at the API
boundary:

| `type` | Required semantic fields |
|---|---|
| `activity` | Optional place and booking/reference note |
| `flight` | Origin/destination airport refs, flight designator when known |
| `rail` | Origin/destination refs and service designator when known |
| `road_transfer` | Origin/destination refs and pickup instructions |
| `lodging` | Property ref and check-in/check-out semantics |
| `meal` | Optional venue ref and reservation note |
| `golf_round` | Golf capability/round reference and tee time |
| `session` | Optional descendant event reference and room/place ref |
| `note` | No provider-specific required fields |

Provider payloads and secrets are never embedded in `details`. Unknown future
types require a new schema version or major contract behavior; they do not
silently pass as arbitrary JSON.

A live session reference always names a strict live descendant. If its
itinerary item is participant-visible, the referenced descendant's complete
root path is also published and participant-visible. Graph and lifecycle
mutations that would violate either rule fail atomically with
`409 DEPENDENCY_EXISTS`. Each event contains at most 500 live itinerary items.

A place reference points at an event-service place candidate or enriched place
and stores a small immutable display snapshot (name, locality, country code,
coordinates when available) on the itinerary item. The reference enables fresh
data; the snapshot keeps an offline itinerary intelligible if enrichment is
pending, changes, or becomes unavailable. Provenance remains on the place
record, not copied into every item.

Chronological views order scheduled items by
`(startsAt, numeric sortKey ASC, id ASC)` and unscheduled items by
`(numeric sortKey ASC, id ASC)`. Hierarchy views retain sibling event order.
Server UTC instants plus explicit IANA zones avoid treating a flight's origin-
local time as destination-local time.

## Typed event capabilities

An event attaches zero or more capability records keyed by
`(eventId, capabilityType)`. Each record has its own version, schema version,
validated data, and tombstone. The initial union is:

- `travel`: trip-level defaults such as home location and traveler-facing
  reference labels;
- `lodging`: property reference, check-in/out policy, and room-assignment mode;
- `transport`: route/meeting-point defaults and participant transport mode;
- `golf`: course reference, tee format, handicap/scoring configuration, and
  round state;
- `team`: team-assignment mode, capacity rules, and optional facilitator data.

Capabilities hold configuration, not a second event tree. Scheduled instances
remain itinerary items or descendant events. Scores, teams, assignments, and
other growing collections get normalized tables owned by their capability;
they are not accumulated into one JSON document. Capability JSON is acceptable
only for a small, versioned, schema-validated configuration that is replaced
atomically and covered by migration tests.

Removing a capability is a tombstone-producing command. It is rejected while
live dependent records exist unless an explicit organizer operation resolves
or archives those dependencies.

## Feed projection

The root feed is an append-only merge of authored entries and domain events.
Every entry has a root ID, optional descendant event ID, actor or system source,
kind, payload schema version, creation time, and root revision.

Published entry identity and creation order never change. An edit creates a
revision that references the prior entry; removal creates a moderation or
author tombstone. Reactions are idempotent `(entryId, userId, reaction)` facts.
This gives mobile a deterministic append/replace/tombstone projection without
pretending mutable messages are conflict-free.

Provider callbacks and the worker write feed-visible effects through the same
event-service application commands. They do not insert feed rows directly.

## Versions, revisions, and tombstones

Editable entities use optimistic concurrency:

- create returns `version = 1`;
- update/delete commands include the observed `baseVersion`;
- a successful update increments the entity version once;
- a stale editable update returns `409 VERSION_CONFLICT` with the safe current
  version and current representation where authorized; and
- a client-created ID plus mutation ID makes an offline create retryable.

Each externally visible transaction also allocates one monotonically
increasing `rootRevision` under the root. All entity changes from that
transaction share the revision and have a stable within-revision ordinal. The
change log contains root, revision, ordinal, entity type/ID, operation, entity
version, and the canonical sync representation or tombstone.

A tombstone contains identity, root/event relationship needed to remove local
read models, final version, deletion time, and revision; it excludes deleted
private content. IDs are never reused. History is retained for a documented
window and compacted only after a root snapshot is available. ADR-005 defines
push/pull envelopes, cursor expiry, snapshot reset, attachment transfer,
deduplication, and retry/dead-letter behavior.

## Transaction and persistence rules

The minimum relational ownership is:

```text
event_roots        1---* events             1---* itinerary_items
      |                   |                  *---0..1 places
      |                   *---* capabilities
      *---* memberships
      *---* invitations
      *---* feed_entries / feed_revisions / reactions
      *---* root_changes / idempotency_records / outbox
```

`event_roots` holds the next revision and lifecycle state. It is not a second
copy of the root event. A command that changes domain state, reserves
idempotency, allocates revisions, appends sync changes, emits domain/feed
events, and writes the transactional outbox does so in one event-service
database transaction.

Foreign keys include `rootEventId` where useful so a row cannot accidentally
reference an entity in another root. Repository methods require a root ID and
actor context; unscoped `findById` helpers are forbidden for member-facing
paths. Other services have no database role on these tables.

## Reference fixtures

These are contract fixtures, not a complete seed format. IDs are client-stable
logical fixture IDs and every write still goes through APIs.

### Turkey golf tour

```json
{
  "event": { "id": "evt_belek", "kind": "trip", "title": "Belek Golf Tour", "timeZone": "Europe/Istanbul" },
  "capabilities": [{ "type": "travel", "schemaVersion": 1 }],
  "children": [
    {
      "event": { "id": "evt_belek_day_1", "kind": "day", "title": "Arrival" },
      "itinerary": [
        { "id": "iti_flight_out", "type": "flight", "title": "Flight to Antalya" },
        { "id": "iti_transfer", "type": "road_transfer", "title": "Airport transfer" },
        { "id": "iti_hotel", "type": "lodging", "title": "Hotel check-in" }
      ]
    },
    {
      "event": { "id": "evt_belek_round_1", "kind": "golf", "title": "Round 1" },
      "capabilities": [{ "type": "golf", "schemaVersion": 1 }],
      "itinerary": [{ "id": "iti_tee_1", "type": "golf_round", "title": "Tee time" }]
    }
  ]
}
```

### Team event

```json
{
  "event": { "id": "evt_offsite", "kind": "team_event", "title": "Crew Offsite", "timeZone": "Europe/Zurich" },
  "capabilities": [{ "type": "team", "schemaVersion": 1 }],
  "children": [
    {
      "event": { "id": "evt_workshop", "kind": "session", "title": "Strategy workshop" },
      "itinerary": [{ "id": "iti_workshop", "type": "session", "title": "Workshop" }]
    },
    {
      "event": { "id": "evt_activity", "kind": "activity", "title": "Team challenge" },
      "itinerary": [{ "id": "iti_activity", "type": "activity", "title": "Outdoor challenge" }]
    }
  ]
}
```

The team fixture proves that travel and golf fields are not prerequisites for
the graph, invitations, itinerary, feed, or sync.

## Required acceptance tests

- Create roots and descendants of multiple depths; read the same deterministic
  tree and flat revision stream.
- Reject self-parenting, descendant-parenting, cross-root parenting, a deleted
  parent, and cross-root location/event references.
- Reorder siblings and itinerary items concurrently; return authoritative order
  or a documented version conflict without duplicates.
- Exercise every authorization-matrix row, including removed members and
  concealed cross-root reads.
- Redeem, replay, expire, revoke, email-bind, and concurrently exhaust invites.
- Create both reference fixtures and prove the team event has no travel/golf
  capability dependency.
- Update with matching and stale versions; produce minimal tombstones and a
  monotonic `(rootRevision, ordinal)` stream.
- Edit/remove feed content through revisions/tombstones and merge reactions
  idempotently.
- Archive a parent without losing descendants; reject unsafe non-cascade
  tombstones and verify an authorized subtree tombstone.
- Roll back a forced transaction failure and prove that domain rows, revision,
  change log, idempotency result, and outbox all roll back together.

These tests run against real Postgres. Unit tests may supplement them but do
not replace constraint, transaction, recursive-query, and concurrency proof.

## Consequences

One model now supports trips, golf outings, and team events while keeping
authorization and offline sync root-scoped. Typed capabilities avoid both a
vertical-specific schema and an unvalidated metadata bag. Versions, revisions,
and tombstones give the mobile app an explicit basis for offline behavior.

The cost is disciplined recursive queries, constraint tests, and capability
migrations. Child-specific secrecy or independent child ownership is not part
of v1; it would require a new authorization-boundary decision rather than a
flag on this model.
