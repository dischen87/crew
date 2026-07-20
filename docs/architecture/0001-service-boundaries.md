# ADR-001: Service boundaries and database ownership

- Status: Accepted
- Date: 2026-07-18
- Bead: `crew-paq.1.2`

## Context

The current Crew backend is one Bun/Hono process that combines authentication,
groups, events, golf, chat, media, administration, static-file delivery, and
direct SQL access. Its user token is a member UUID, events are flat, and most
routes do not prove that the caller belongs to the requested event. The native
mobile tree is not runnable.

Crew Next is mobile-first and offline-first. A person can organize many event
types, invite others, nest events to any practical depth, publish an itinerary,
communicate in a durable feed, enrich places on demand, and submit product
feedback. The Turkey golf tour and a non-travel team event must use the same
core model.

The Swiss Activities repositories establish useful implementation conventions:
Bun, TypeScript, Hono, Zod/OpenAPI, `postgres.js`, explicit migrations, typed
service clients, request IDs, structured logs, Docker, and real-Postgres tests.
Crew adopts those conventions without copying Swiss Activities product domains
or its external identity provider.

## Decision

Crew starts with three independently deployable services and one worker runtime:

1. `api-gateway`
2. `user-service`
3. `event-service`
4. `event-worker`, built and deployed from the `event-service` codebase

The mobile app calls only the gateway. Each service owns its API contract and
database. No client, service, job, admin tool, or analytics process may query or
mutate another service's database.

### API gateway

The gateway is the public mobile edge and owns no product truth.

It owns:

- access-token verification against the user-service JWKS;
- rate limiting, request-size limits, timeouts, and request IDs;
- routing and small response compositions across service APIs;
- pinned downstream OpenAPI documents and generated clients;
- public OpenAPI/Scalar documentation for the mobile contract;
- a service-owned external Redis namespace for replica-safe rate-limit windows.

It does not own users, memberships, events, feed entries, sync history, places,
feedback, or attachments. A gateway outage must not create an alternative data
store or permit a write that the owning service would reject.

### User service

The user service owns global identity and user-scoped state:

- stable `usr_*` identity;
- verified email and future identity methods;
- magic-link/invite-assisted sign-in, sessions, refresh-token rotation, and
  revocation;
- asymmetric access-token signing and a public JWKS endpoint;
- profile, avatar, locale, accessibility preferences, and notification choices;
- registered devices and push tokens;
- privacy export, account deletion, and security audit records.
- a service-owned external Redis namespace for authentication abuse-control
  windows.

The existing raw-member-UUID bearer token and shared fallback password are not
carried forward. Access tokens are short-lived and signed with an explicitly
pinned algorithm. Refresh tokens are opaque, rotated, hashed at rest, and
revocable.

The user service does not own event roles. Being an organizer, participant, or
guest is always scoped to an event root and therefore belongs to the event
service.

### Event service

The event service is the initial collaboration bounded context. It owns:

- recursive events, root identity, event type, capabilities, and versions;
- root-scoped memberships, roles, and invitations;
- itinerary items, locations, travel, lodging, transport, golf, and team-event
  metadata;
- feed entries, comments, reactions, decisions, and attachment metadata;
- offline mutation deduplication, ordered change history, cursors, tombstones,
  conflicts, and snapshot generation;
- a lightweight worldwide place-candidate catalog and enrichment state;
- feedback, votes, comments, duplicate links, visibility, and public status
  history;
- a transactional outbox for asynchronous effects.

These are separate feature modules inside one service. They use explicit route,
service, and repository boundaries, but they do not become separate deployables
until an extraction trigger below is met.

### Event worker

The worker is a separate runtime with no public routes. It reads leased jobs
from the event-service outbox and performs:

- invitation and push delivery;
- attachment post-processing;
- place discovery and enrichment;
- feed notifications and digests;
- retry, dead-letter, and reconciliation work.

It uses the event-service database because it is part of the same bounded
context. Claims include `status`, `lease_until`, and `worker_id`; handlers are
idempotent. The gateway request path never waits for Exa, an LLM, media
processing, or a notification provider.

## Data ownership matrix

| Data or capability | System of record | Derived or external store |
|---|---|---|
| Identity, credentials, sessions | User-service Postgres | JWKS cache in gateway |
| Profile, devices, notification preferences | User-service Postgres | Push provider registration |
| Event tree, root, capabilities | Event-service Postgres | Mobile SQLite read model |
| Memberships, roles, invitations | Event-service Postgres | Mobile SQLite read model |
| Itinerary, travel, lodging, transport | Event-service Postgres | Mobile SQLite read model |
| Feed, reactions, decisions | Event-service Postgres | Mobile SQLite read model |
| Attachments | Event-service metadata | S3-compatible object storage |
| Sync mutations, changes, tombstones | Event-service Postgres | Mobile SQLite outbox/cursor |
| Place candidates and enrichment provenance | Event-service Postgres | Typesense search index |
| Feedback and public status history | Event-service Postgres | Optional PostHog analytics signal |
| Async effects | Event-service outbox | External mail, push, Exa, LLM providers |
| Rate-limit windows | No product truth | Gateway/User service-owned Redis namespaces with TTL and AOF |

Typesense, Redis, object storage, mobile SQLite, PostHog, and provider APIs are
never authoritative for a domain entity that belongs in Postgres.

## Trust and request paths

### User request

1. Mobile sends its short-lived user-service access token to the gateway.
2. Gateway verifies issuer, audience, expiry, signature, and pinned algorithm.
3. Gateway forwards the original bearer token and `X-Request-ID` to the owning
   service through a generated client with a short timeout.
4. The owning service verifies the token again and derives the actor from its
   subject. It never trusts a client-supplied `user_id`.
5. Event-service authorization resolves membership against the root event, then
   applies organizer/member/guest permissions to the requested descendant.

### Internal request

Internal endpoints use a service-specific bearer credential with explicit
audience and rotation. They are not authorized by network location alone. Jobs
prefer the transactional outbox over HTTP when the worker belongs to the same
bounded context.

### Invite redemption

Invite codes belong to the event service. A gateway redemption flow may call
the user service to establish or authenticate a global identity, then call the
event service to consume the invitation and create a membership. Neither
service writes the other's tables, and the invite is single-use or explicitly
multi-use according to its API-created policy.

## Database and mutation rules

- Each service receives credentials only for its own database.
- Product data is created and changed through the owning service API.
- Route handlers call services; services call repositories; routes do not issue
  SQL directly.
- Migrations are append-only deployment artifacts owned by the service. They
  change schema, not live product meaning.
- Deterministic demo fixtures are created through authenticated seed clients or
  internal APIs, never by a cross-service SQL script.
- Admin and future web surfaces use the same APIs as mobile.
- Analytics may read exported events or replicas but cannot become a write path.

## When to extract another service

A module is extracted only when at least one of these is demonstrated and the
API/data-ownership split is clear:

- it needs independent scaling or a materially different availability target;
- it has a distinct security, retention, residency, or compliance boundary;
- it is reused by multiple bounded contexts and cannot evolve safely in one;
- it has an independent team and deploy cadence;
- measured load or failure isolation shows it harms the event-service SLO.

Likely future candidates are `catalog-service`, `communication-service`,
`feedback-service`, and `notification-service`. Names alone are not reasons to
extract them. Until a trigger is met, feature modules plus the separate worker
give Crew the same API discipline with fewer distributed failure modes.

## Repository transition

The current `packages/api` and `packages/web` remain as legacy reference during
the additive build. New deployables will live under `services/`, and the new
native app under `apps/mobile`. Legacy endpoints are frozen except for critical
fixes. Cutover requires contract, authorization, offline, and both vertical-
slice gates; this ADR does not authorize deleting the old implementation.

## Consequences

### Positive

- Data ownership and authorization are unambiguous.
- Mobile has one stable edge while services remain independently testable.
- Offline sync and collaboration share one transactional boundary.
- On-demand enrichment stays out of latency-sensitive requests.
- The architecture proves generality before paying for many deployables.

### Accepted trade-offs

- Event-service begins broader than a textbook microservice. Feature boundaries
  and extraction triggers keep that choice reversible.
- Invite redemption is a multi-service workflow. Idempotency and compensating
  responses are required because there is no cross-database transaction.
- The gateway adds one network hop. It buys a stable mobile contract, central
  traffic policy, and controlled service evolution.
- Building secure first-party sessions costs more than keeping the current
  member UUID token, but that existing mechanism is not safe to ship.

## Rejected alternatives

### Keep the current API monolith

Rejected because it combines edge, authentication, domains, media, and static
hosting; routes issue SQL directly; ownership and tenant authorization are not
enforceable boundaries.

### Create a service for every feature now

Rejected because separate feed, sync, catalog, feedback, golf, transport, and
notification services would add distributed transactions and operations before
their scaling or ownership needs are proven.

### Let mobile call every service directly

Rejected because the user explicitly requires gateway traffic handling and the
mobile contract would otherwise couple to every service topology and auth
change.

### Share one database with separate schemas

Rejected because credentials and ad-hoc joins would turn API boundaries into a
convention. Separate databases make violations fail technically.

### Reuse the current group-member authentication

Rejected because a raw UUID is not a signed, expiring session; display names
are not identities; and one member row cannot safely represent a person across
many groups and events.
