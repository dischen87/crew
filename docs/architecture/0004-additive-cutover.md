# Migration Plan 004: Additive legacy-to-next cutover

- Status: Proposed
- Date: 2026-07-18
- Bead: `crew-paq.1.6`
- Depends on: `crew-paq.1.1`, ADR-001 (`0001-service-boundaries.md`)

## Outcome

Crew Next is built beside the existing Crew implementation. The legacy
`packages/api` and `packages/web` remain deployable and inspectable until the
new gateway, services, native app, data migration, and operational controls
have all produced the proof listed in this plan.

The migration has five non-negotiable rules:

1. Mobile calls only the new API gateway; it never calls a service or legacy
   API directly.
2. Every event root has exactly one writable system of record at a time. We do
   not dual-write the same event to legacy and Next.
3. Data and demo fixtures enter an owning service through an authenticated API.
   No migration script, client, admin surface, or service writes another
   service's database.
4. A legacy feature is reused, explicitly replaced, or explicitly retired with
   product approval. It is never lost merely because its directory disappears.
5. Legacy deletion is a separate, evidence-gated change. Completing a mobile
   pilot or switching production traffic does not authorize deletion.

## Audited baseline

The cutover starts from observed repository behavior, not from an assumed
greenfield state.

| Observation | Evidence | Migration consequence |
|---|---|---|
| One Bun/Hono process owns authentication, groups, events, golf, chat, media, activities, locations, admin, uploads, and PWA hosting. | `packages/api/src/index.ts` mounts every `/v2` route and serves both uploads and `packages/web/dist`. The Docker Compose files deploy one `app` with one Postgres and Redis. | Do not rename this process into a gateway. Build the gateway and owning services separately. |
| Legacy authentication is a member UUID, not a session. | `packages/api/src/middleware/auth.ts` accepts `Bearer <member_id>` or `X-Member-ID`; `packages/api/src/routes/auth.ts` returns the member ID as `token` and retains a shared-password fallback. | Identity is re-established in `user-service`; raw member tokens and the shared event password are not migrated as credentials. |
| Authentication does not consistently prove tenant authorization. | `events.get('/:id')`, `groups.get('/:id')`, `chat.get/post('/:groupId/messages')`, and media event routes query caller-supplied IDs without first matching the authenticated member's group. Event creation also accepts a client-supplied `group_id`. | New services need root-scoped membership checks and negative cross-root tests before any live cohort moves. |
| Events are flat and tied to a group. | `packages/api/src/db/schema.sql` gives `events` a `group_id` but no parent, root, path, or version fields. | Legacy event rows become roots or descendants through an explicit mapping; the legacy schema is not copied. |
| Route handlers and fixture scripts issue SQL directly. | `packages/api/src/routes/*` imports the SQL client. `packages/api/src/db/seed.ts` inserts demo records; `seed-belek.ts` first deletes domain tables and then recreates the Belek tour. | These scripts are frozen reference inputs. Next fixtures and migration use service APIs only. |
| Offline support is narrow. | `packages/web/src/lib/offlineDb.ts` has only `pendingScores`, `courseHoleCache`, and `roundCache`; `syncEngine.ts` flushes score mutations only. | Keep the scenarios and local Stableford behavior as test input, but replace this queue with the complete SQLite outbox/change protocol. |
| The native app is not a runnable application yet. | `apps/mobile` has a join screen and a few chat/image components but no `package.json` or app shell. Its join screen calls an unmounted `GET /v2/auth/invite/:code` and sends fields that do not match legacy `POST /v2/auth/join`. | Treat these files as UX prototypes. Establish a runnable, generated-client-based native app in place. |
| The legacy API has no committed OpenAPI contract. | No OpenAPI document or generated server/client contract exists for `packages/api`; route behavior is expressed directly in handlers. | Capture a black-box legacy endpoint inventory, but define all Next APIs contract-first rather than preserving accidental handler shapes. |

Useful legacy material still exists: the product vocabulary and flows in the
PWA, the Belek 2025/2026 scenarios, curated golf-course inputs,
`packages/shared/src/stableford.ts`, brand assets, and UI copy. These are inputs
to the replacement, not reasons to retain the unsafe architecture.

## Directory transition

| Current path | Next path | Disposition |
|---|---|---|
| `packages/api` | `services/api-gateway`, `services/user-service`, `services/event-service` | Freeze as the legacy runtime. Reimplement through owned OpenAPI contracts; do not move its shared database or route files. |
| Background work inside request handlers | worker entry point built from `services/event-service` | Move enrichment, previews, media processing, notifications, retries, and reconciliation behind the event-service outbox. |
| `packages/web` | `apps/mobile` | Keep the PWA available for legacy cohorts while the native app reaches parity. It is not the base of the native app. |
| Partial `apps/mobile` files | runnable `apps/mobile` workspace | Preserve potentially useful presentation work, but make every screen use generated gateway clients and the shared mobile SQLite read model/outbox. |
| `packages/shared` | narrowly scoped Next packages or owning service modules | Port only pure, proven code such as Stableford calculations, with golden tests. Do not share service persistence models or database access. |
| `apps/web` | optional thin public invite/download surface | It may remain only as a gateway client for universal links and app discovery. It must not become a second planning client, store member IDs as authentication, or call legacy after its own cutover. |
| SQL seed scripts and `belek-golf-courses.json` | API-driven fixture runner and versioned fixture manifests | Convert semantic fixture data, not passwords, generated IDs, SQL, or legacy table layout. |

The target deployment begins with the three services and one worker runtime
defined by ADR-001. Feed, sync, places, feedback, and travel remain modules of
`event-service` until a measured extraction trigger is met.

## What is reused and what is frozen

### Reused after verification

- Crew, member, invitation, event, itinerary, flight, accommodation, package,
  golf round, score, handicap, team, activity, message, media, and location
  vocabulary informs the Next capability ledger.
- Belek fixture content and curated golf facts may be transformed into fixture
  requests with provenance such as `legacy_fixture` or `curated`.
- Stableford calculations may be ported as pure code only after legacy golden
  cases run identically in event-service and on mobile.
- Existing brand assets, copy, and interaction ideas may be reused after design,
  accessibility, ownership, and platform review.
- Legacy offline score flows become regression scenarios for idempotency,
  retries, conflicts, and reconnect behavior.

### Not reused as architecture

- member UUID bearer tokens, `X-Member-ID`, shared passwords, or legacy password
  fallback;
- the flat group/event schema, table IDs as public contracts, or a shared
  database;
- SQL from routes, admin imports, setup scripts, or seeds;
- the PWA IndexedDB score-only queue as the mobile sync engine;
- local upload paths or fire-and-forget provider calls in request handlers;
- implicit TypeScript handler shapes as an API specification.

### Legacy freeze policy

Before Next implementation starts, record the legacy source SHA, deployed image
digest, route inventory, database migration version, and a restorable backup as
the `legacy-baseline` release record.

From that baseline:

- no new legacy endpoint, database table, product module, or PWA feature is
  added;
- no Next client or service gains a new dependency on a legacy endpoint;
- only P0 security, privacy, data-loss, or live-trip availability fixes may
  change legacy behavior;
- every allowed fix gets a regression case and a corresponding Next capability
  decision so the replacement does not regress it;
- a narrowly authenticated, read-only migration export endpoint is the only
  planned API-surface exception. It is versioned, auditable, disabled by
  default, returns no credential hashes, and is removed with legacy;
- legacy migrations may protect existing live data but may not evolve it toward
  the Next schema.

## Additive topology and source-of-truth boundary

During dual-run, the stacks do not share credentials or databases:

```text
legacy PWA  -> packages/api ----------------> legacy Postgres / uploads

native app  -> api-gateway -> user-service -> user Postgres
                          \-> event-service -> event Postgres / object store
                                            -> outbox -> event worker
```

Every root event has a recorded state: `legacy`, `migration_locked`, `next`, or
`archived`. The event service owns that state once the root is imported; the
release runbook records the corresponding legacy ID and Next ID. Routing and
support tools use the ledger through service APIs, never through database
lookups.

Dual-run means both stacks operate for different whole-root cohorts. It does
not mean that a score goes to legacy while a feed entry for the same root goes
to Next. Shadow comparisons are read-only. Provider side effects are disabled
in shadow environments or directed to test recipients.

## Migration phases

### Phase 0: Preserve and inventory

1. Create the baseline release record and verified legacy backup.
2. Generate a capability ledger from every registered legacy route, PWA screen,
   admin action, fixture, scheduled/provider effect, and stored media type.
3. Assign each capability `reuse`, `replace`, or `retire`. `Retire` requires a
   named product decision and user-impact note; an unassigned row blocks
   cutover.
4. Add black-box legacy characterization tests for the data that will be
   exported. These tests document behavior but do not make it the Next contract.

### Phase 1: Build beside legacy

1. Create service databases, migrations, OpenAPI contracts, generated clients,
   health checks, logs, metrics, backups, and isolated deployments under
   `services/`.
2. Complete `apps/mobile` as a runnable React Native application. Mobile has one
   gateway base URL and no service or legacy URLs.
3. Implement first-party sessions, recursive event roots, memberships,
   invitations, itinerary, feed, full offline sync, places/enrichment,
   feedback, object storage, and outbox processing behind service APIs.
4. Keep production legacy traffic unchanged. New services first receive only
   synthetic and API-created demo roots.

### Phase 2: Port deterministic fixtures through APIs

The fixture runner is a normal API client with a non-production service
credential. It must not import database clients or receive database passwords.

For each fixture run it:

1. creates or retrieves deterministic demo users through the user-service demo
   API using logical keys such as `demo/mathias`, never hard-coded target IDs;
2. creates the root and memberships through event-service APIs using the
   returned user IDs;
3. creates descendants, itinerary entries, travel, lodging, transport, golf or
   team-event details, feed entries, attachments, and feedback in dependency
   order;
4. submits curated place candidates through the place API, including source,
   retrieval time, confidence, and license/provenance; it never bulk-loads a
   supposed worldwide catalog;
5. supplies an idempotency key per logical fixture record and can be run twice
   without duplicates;
6. reads the completed root back through the gateway and writes a redacted
   reconciliation report containing logical keys, returned IDs, counts, and
   content hashes.

Two fixtures are mandatory:

- **Turkey golf tour:** invitation, travel, accommodation, ground transport,
  nested golf days/rounds, searchable/on-demand course enrichment, scoring,
  feed/media, and offline mutations.
- **Team event:** invitation, venue, agenda, nested sessions/activities,
  transport when enabled, decisions/feed/media, feedback, and offline
  mutations. It must not acquire travel or golf fields merely to fit the first
  fixture.

The destructive `seed-belek.ts`, direct-SQL `seed.ts`, and course-description
seed are never run against a Next database.

### Phase 3: Import and reconcile a legacy root

1. The migration client calls the authenticated legacy export API and stores an
   immutable, encrypted, access-logged export artifact with schema version and
   checksum.
2. It validates the export and reports unsupported records before writing.
3. Legacy members receive claim/invite flows in user-service. Password hashes,
   raw member tokens, and shared event passwords are excluded. A mapping from
   legacy member ID to the returned `usr_*` ID is passed to event-service via
   the import API as migration provenance.
4. The event-service import API performs `validate-only` first, then an
   idempotent import keyed by export checksum. It maps group/event data into a
   root tree and creates feed, itinerary, travel, golf, media metadata, and
   other supported capabilities through owning application services.
5. Binary media moves via signed object-storage APIs; database rows never point
   at copied local filesystem paths.
6. Reconciliation compares source and target counts, required fields,
   memberships, capability-specific totals, media checksums, timestamps, and
   sampled rendered responses. Every omission is listed, never silently
   discarded.

This phase is repeatable in a disposable environment before a live root is
locked.

### Phase 4: Pilot and root cutover

1. Run both fixtures with internal users, then pilot one consenting root on
   real devices.
2. Announce a short write lock for the selected legacy root. Let the legacy PWA
   finish or reject outstanding score uploads; export and import the final
   delta; reconcile; then mark the root `next`.
3. Distribute a mobile build whose gateway contract is compatible with the
   deployed services. The old PWA becomes read-only for that root and links to
   the native app/support path.
4. Observe the pilot through the agreed window. Unrelated legacy roots remain
   writable in legacy and can continue their trips.
5. Repeat root by root. There is no database-wide big-bang switch.

### Phase 5: Default and decommission

Make Next the default only after all cutover gates below pass. Keep the legacy
runtime, image, database backup, media archive, route inventory, and source tag
available through the rollback window. Deletion requires the separate proof in
the final section.

## Cutover gates

Each gate needs an attached command output, report, trace, screenshot, or
dashboard link for the release candidate; a statement that the code exists is
not proof.

### Contract and boundary gate

- All public and internal service routes are described by pinned OpenAPI
  documents, linted, compatibility-checked, and exercised by generated clients.
- Mobile traffic reaches only the gateway; network inspection and repository
  search find no legacy or service base URL in the released app.
- Request IDs and the standard error envelope survive gateway-to-service calls.
- Service credentials cannot connect to another service database, demonstrated
  by a failing boundary test.

### Identity and authorization gate

- Signed access tokens, JWKS verification, refresh rotation, revocation, and
  invite redemption pass integration tests.
- Organizer, participant, guest, removed-member, expired-invite, and descendant
  inheritance cases pass.
- Cross-root read and write attempts fail for every resource family, including
  feed, media, sync, travel, golf, places, and feedback.
- No released request accepts a client-supplied actor identity as authority.

### Data and fixture gate

- Both mandatory fixtures create, read, update, sync, and delete/tombstone their
  full graphs exclusively through APIs, and a second run is idempotent.
- A production-shaped legacy export completes validate-only, import, and
  reconciliation with zero unexplained records and verified media checksums.
- Backup restore drills for user-service and event-service meet the recorded
  recovery objectives.

### Functional vertical-slice gate

- The Turkey golf tour completes organizer creation, invitations, participant
  joining, recursive itinerary, travel/lodging/transport, on-demand course
  enrichment, scoring, feed/media, feedback, and recap.
- The team event completes the equivalent lifecycle with venue, agenda,
  sessions/activities, decisions, feed/media, feedback, and recap.
- Every `replace` row in the capability ledger has an automated or signed manual
  acceptance result; every `retire` row has product approval.

### Offline and mobile UX gate

- On supported iOS and Android devices, users can open a synced root, create and
  edit permitted content, post to the feed, and complete both fixture-critical
  flows in airplane mode.
- Reconnect uploads queued mutations automatically. Duplicate delivery,
  interruption, reordering, token refresh, tombstones, and declared conflicts
  produce deterministic results without data loss.
- SQLite migration from the previous released mobile schema succeeds with a
  populated database.
- Accessibility checks, crash-free pilot sessions, cold-start and sync
  performance budgets, deep links, push links, and the highest-risk screens
  pass on real devices. UX sign-off covers organizer and participant journeys.

### Operations and pilot gate

- Logs, traces, metrics, alerts, outbox lag, dead letters, provider budgets,
  rate limits, and audit records identify a request and root without exposing
  secrets.
- Worker retry, dead-letter replay, provider outage, gateway rollback, database
  restore, and object-storage recovery drills are recorded.
- One real golf root and one real team-event root complete the agreed pilot
  lifecycle without an unresolved P0/P1 migration, auth, sync, or data-loss
  defect.

## Rollback boundary

Rollback is root-scoped and depends on whether Next has accepted a write.

### Before the first Next write

If import, reconciliation, mobile distribution, or read-only shadowing fails,
discard the target import, unlock the legacy root, and keep its users on the
legacy PWA. Legacy remains authoritative and no reverse migration is required.

### After the first Next write

The root is authoritative in Next. Never point it blindly back to the stale
legacy database.

1. Use gateway/mobile feature flags to stop risky writes or put the affected
   root in maintenance/read-only mode.
2. Roll back gateway, service, worker, or mobile code only to a version proven
   compatible with the current Next schemas and sync protocol.
3. Restore Next from its backups/outbox if data was corrupted, then reconcile
   through service APIs.
4. Returning the root to legacy requires an explicit reverse export,
   validate-only import, write lock, reconciliation, and ownership-ledger
   change through APIs. Until that succeeds, keep Next authoritative.

Mobile release controls must retain the last compatible build, minimum
supported contract version, remote kill switches, and an upgrade path. Database
migrations are forward-compatible during the rollback window; a destructive
schema rollback is not an incident procedure.

## Proof required before deleting legacy

`packages/api`, `packages/web`, their database, uploads, images, and deployment
files may be removed only in a dedicated decommission change after all of the
following evidence is attached:

- the baseline capability ledger has no unassigned or silently omitted row;
- all roots are `next` or explicitly archived, and final API reconciliation has
  zero unexplained records;
- production telemetry shows zero legitimate legacy API/PWA traffic for at
  least 30 consecutive days and across two supported mobile release cycles;
- unsupported old clients receive a safe upgrade/read-only response, not data
  corruption or an authentication bypass;
- one production golf trip and one production team event have completed on
  Next, including offline reconnect and feedback;
- support, security, privacy export/deletion, audit, enrichment, media, and
  recovery runbooks have been exercised against Next;
- source search, dependency graphs, container manifests, DNS/proxy config,
  scheduled jobs, monitoring, and generated clients prove that no active
  runtime imports or calls legacy;
- user-service, event-service, object storage, and audit artifacts have verified
  backups and retention policies; the final legacy database/media archive has
  a checksum, owner, restore instructions, and deletion date;
- the post-write rollback window has ended and incident owners approve removal
  of the legacy runtime;
- product, engineering, operations, security/privacy, and support sign the
  decommission record.

Until that proof exists, legacy can be disabled and read-only, but its source
and recovery artifacts remain available. No earlier phase of this plan implies
permission to delete an existing feature or its only recoverable data.
