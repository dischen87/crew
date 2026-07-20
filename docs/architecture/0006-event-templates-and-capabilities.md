# ADR-006: Static event templates and persisted capabilities

- Status: Accepted
- Date: 2026-07-18
- Bead: `crew-paq.2.7`
- Depends on: [ADR-003](./0003-event-domain.md),
  [ADR-005](./0005-offline-sync-protocol.md)

## Context

Travel groups, golf tours, and team events need useful starting structures,
but they share the same recursive event aggregate. A second template service,
database-managed template language, or product-specific event tables would add
coordination and migration cost without improving the first product flows.

The domain also needs typed travel, lodging, transport, golf, and team settings
that can be changed after creation and converge through offline sync. Those
settings must not become an unvalidated JSON extension point or duplicate
scheduled itinerary facts.

## Decision

`event-service` publishes exactly three immutable version-1 built-ins:
`travel`, `golf-tour`, and `team-event`. `GET /v1/event-templates` returns their
deterministic metadata and logical event keys. Template data remains static
application code; there is no template database or generic schema registry.

The existing `POST /v1/event-roots` accepts an optional strict `template`
block. It contains the template ID, its exact version, and one client-generated
`evt_*` ID for every logical key. Missing keys, extra keys, duplicate IDs,
unknown templates, and stale versions fail before persistence. Clients retain
stable offline identities without allowing a partially expanded template.

Instantiation is one repository transaction. It locks the root identity,
claims idempotency through the normal command boundary, and inserts the root,
owner membership, descendants, and default capabilities. All records are
created at entity version 1 and one `rootRevision = 1`; change ordinals are
contiguous and deterministic. Any failure rolls back every row and the
idempotent replay returns the stored original result.

`POST /v1/event-roots/{rootEventId}/template` is the explicit migration path
for an existing untemplated draft. It requires the current root version,
aggregate revision, exact template version, and caller-stable IDs for every
logical key. The transaction locks the existing aggregate row first and then
the sorted caller IDs, authorizes an active owner or organizer, and rejects
stale, archived, published, deleted, incompatible, already-templated, or
colliding state before its first write. An `other` root may convert to the
template root kind; an already compatible kind stays compatible. Existing
titles, descriptions, dates, places, itinerary, children, and unrelated
capabilities are preserved. Version-1 templates are root-flat, so adoption
appends their children, bumps root version and child-order version once, and
emits the updated root, new children, and new capabilities as contiguous
changes in exactly one new aggregate revision.

`event_capabilities` persists at most one live record per
`(rootEventId, eventId, type)`. The type union is closed to `travel`,
`lodging`, `transport`, `golf`, and `team`; schema version 1 validates an exact
configuration shape in both the API and PostgreSQL. Root/event/type identity is
immutable, referenced events and places must be live and in the same root, and
updates use optimistic versions. A generated primary-place column keeps the
same-root place relationship enforceable by a foreign key.

Capability replacement and removal use the existing root-first lock order.
Removal emits a tombstone and fails with `CAPABILITY_DEPENDENCIES_EXIST` while
live itinerary records still depend on lodging, transport, or golf behavior.
Published-event capabilities are member-visible in root reads and sync;
draft-event capabilities remain manager-only. Capability place references
participate in the same actor-visible place projection and authorization-scope
invalidation as itinerary place references.

## Built-in shapes

| Template | Event tree | Default capabilities |
|---|---|---|
| `travel` | trip root, arrival, lodging | root travel; arrival transport; lodging lodging |
| `golf-tour` | trip root, arrival, lodging, golf round | root travel; arrival transport; lodging lodging; round golf |
| `team-event` | team-event root, agenda session, activity | root team only |

Templates create structure and small configuration defaults only. They do not
create dummy itinerary records, provider payloads, scores, assignments, or
other growing collections. Every created event and capability remains editable
through the ordinary event-service APIs.

## Consequences

- A template upgrade is a new explicit version; existing roots never change
  silently.
- Adding a built-in or capability schema version requires a code, OpenAPI,
  migration, and sync-contract change reviewed together.
- Template creation can be retried safely and cannot expose half a tree.
- Team events do not inherit travel or golf dependencies merely from their
  presentation kind.
- The event service remains the only writer of its graph and capability data;
  the gateway and mobile store consume API-defined projections only.
