# ADR-002: API contract standard

- Status: Accepted
- Date: 2026-07-18
- Bead: `crew-paq.1.3`
- Depends on: [ADR-001](./0001-service-boundaries.md)

## Context

Crew is a mobile-first, offline-first product. The mobile app calls only the
API gateway, while the gateway calls the user service and event service through
their APIs. A stale hand-written model, an undocumented error, or a renamed
operation can therefore break both an installed app and another deployable.
Direct database access is never a compatibility mechanism.

The current Swiss Activities gateway and user service provide the starting
pattern:

- Bun, TypeScript, Hono, `@hono/zod-openapi`, Zod, and Scalar;
- code-first routes rendered with `doc31` or `getOpenAPI31Document`;
- a shared `{ error: { code, message, requestId } }` response shape;
- `X-Request-ID` middleware and structured logging;
- a downstream OpenAPI document pinned in the gateway, types generated with
  `openapi-typescript`, and a CI diff that detects stale generated output.

Crew keeps those useful conventions and makes the missing guarantees explicit:
stable operation IDs, one richer error schema, explicit auth on every
operation, cursor pagination, durable write idempotency, generated clients for
every consumer, semantic contract versions, and breaking-change gates.

## Decision

Every HTTP API owned by Crew is code-first OpenAPI 3.1. The executable route
schema is the source of truth. A generated and committed OpenAPI document is
the review, diff, pinning, and client-generation artifact; it is not maintained
by hand.

The standard applies to:

- the gateway's public mobile API;
- the user-service and event-service APIs consumed by the gateway;
- service-only endpoints;
- webhook ingress; and
- future services extracted under ADR-001.

Health probes may use a minimal non-OpenAPI router when required by the
platform. They remain the only exception.

## Contract source and layout

Each service owns all three layers below:

1. Zod schemas and `createRoute` declarations beside the route implementation;
2. a deterministic `openapi/openapi.json` generated from `OpenAPIHono`; and
3. contract tests that exercise the route and the generated document.

All documents declare `openapi: 3.1.0`. Generation uses `doc31` or
`getOpenAPI31Document`, never the OpenAPI 3.0 renderer. JSON is lower camel case,
timestamps are RFC 3339 UTC strings, durations are explicit integer seconds,
money uses integer minor units plus an ISO 4217 currency, and identifiers remain
opaque strings such as `usr_*`, `evt_*`, and `fed_*`.

Request objects reject unknown fields. Response objects describe every field
the service can emit. Optional means the member may be absent; nullable means
the member is present and may be `null`. Those meanings are not interchanged.
Examples are part of the route declaration and must validate against the same
schema.

The public gateway document contains only mobile-reachable paths. Internal and
webhook operations live in a separate service document or are filtered from
the public document before it is committed. Runtime startup never downloads a
contract from another service.

## Route declaration standard

Every operation declares its method, versioned path, unique `operationId`, tag,
summary, description where behavior is not obvious, explicit security,
request schemas, success responses, applicable error responses, and response
headers. Shared components are imported from the service's contract module.

```ts
const eventsCreate = createRoute({
  method: 'post',
  path: '/v1/events',
  operationId: 'eventsCreate',
  tags: ['events'],
  summary: 'Create a root event',
  security: [{ userBearer: [] }],
  request: {
    headers: IdempotencyHeadersSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: CreateEventSchema.strict() } },
    },
  },
  responses: {
    201: jsonResponse(EventSchema, 'Created', {
      Location: LocationHeader,
      'X-Request-ID': RequestIdHeader,
    }),
    400: errorResponse('Invalid request'),
    401: errorResponse('Authentication required'),
    409: errorResponse('Conflict or idempotency-key reuse'),
    429: errorResponse('Rate limited', { 'Retry-After': RetryAfterHeader }),
    500: errorResponse('Unexpected failure'),
    503: errorResponse('Temporarily unavailable'),
  },
  'x-idempotency': 'required',
});
```

Shared response helpers reduce repetition but must expand to ordinary OpenAPI
response objects. No route may hide possible status codes behind an
undocumented generic response.

### Stable operation IDs

Operation IDs are public client method names, not generated labels.

- Use lower camel case matching `^[a-z][A-Za-z0-9]+$`.
- Start with the bounded context, then resource, then action:
  `eventsList`, `eventsCreate`, `eventChildrenCreate`,
  `eventFeedEntriesList`, `eventInvitationsRedeem`, and
  `syncMutationsApply`.
- Do not encode the HTTP verb, path version, or implementation service name.
- IDs are globally unique within a document and unique within a major-version
  operation-ID registry.
- Once released, an ID is never renamed or reused for different semantics.
  Moving a handler or changing a path does not change the ID.
- A genuinely new behavior receives a new ID. Deprecation preserves the old
  ID until the operation is removed under the version policy.

CI maintains an append-only mapping of `method + path -> operationId` for every
released major. This catches operation-ID changes that a structural OpenAPI
diff may otherwise consider harmless but generated clients would not.

## Error contract

Every JSON error, including router validation, authentication middleware,
rate limiting, an unknown route, an upstream failure, and the final `onError`
handler, uses `application/json` and this envelope:

```ts
const ErrorDetailSchema = z.object({
  code: z.string(),
  path: z.string().optional(), // JSON Pointer, for example /title
  message: z.string(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
}).strict().openapi('ErrorDetail');

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
    details: z.array(ErrorDetailSchema).optional(),
  }).strict(),
}).strict().openapi('ErrorEnvelope');
```

Example validation response:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid fields.",
    "requestId": "c19447f4-d67d-4a77-9eb3-3978ad90ea38",
    "retryable": false,
    "details": [
      {
        "code": "TOO_SHORT",
        "path": "/title",
        "message": "Title must contain at least 2 characters."
      }
    ]
  }
}
```

`error.code` is a stable, upper-snake-case machine contract. Mobile branches on
the code, never on `message`. Messages and details are safe fallbacks for people
and logs; they contain no stack trace, SQL, credential, provider response, or
existence information the caller is not authorized to know. The app owns
localized presentation copy.

The common code-to-status baseline is:

| HTTP | Common code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_FAILED`, `CURSOR_INVALID` | Input cannot be accepted |
| 401 | `UNAUTHENTICATED` | Missing, expired, or invalid identity |
| 403 | `FORBIDDEN` | Valid identity lacks permission |
| 404 | `NOT_FOUND` | Missing or deliberately concealed resource |
| 409 | `CONFLICT`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` | Current state conflicts with the command |
| 410 | `CURSOR_EXPIRED` | A new snapshot/sync bootstrap is required |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds the documented limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Unsupported body representation |
| 422 | `BUSINESS_RULE_VIOLATION` | Valid shape violates a domain rule |
| 429 | `RATE_LIMITED` | Retry according to `Retry-After` |
| 500 | `INTERNAL_ERROR` | Unexpected Crew failure |
| 502 | `UPSTREAM_ERROR` | A required provider returned an invalid failure |
| 503 | `SERVICE_UNAVAILABLE` | Temporary dependency or service outage |
| 504 | `UPSTREAM_TIMEOUT` | A bounded downstream call timed out |

Domain codes may be more precise but cannot change meaning after release.
`retryable` describes whether an unchanged request may plausibly succeed later;
`Retry-After` remains authoritative when present. A shared exhaustive mapping
converts typed service errors to HTTP status and envelope. Route handlers return
literal documented statuses so TypeScript and OpenAPI remain aligned.

## Authentication tiers

Every operation sets `security`, including public operations (`security: []`).
Relying on a document-level default is forbidden because a newly mounted route
could otherwise be exposed or documented incorrectly.

| Tier | OpenAPI scheme | Intended use | Required checks |
|---|---|---|---|
| Public | `security: []` | Sign-in bootstrap, JWKS, safe invite preview | Rate and payload limits; no private event data |
| User | `userBearer` (`http`, bearer, JWT) | Mobile through gateway and the same user request at the owning service | Signature, pinned algorithm, issuer, audience, expiry; actor from `sub`; event authorization in event service |
| Service | `serviceBearer` (`http`, bearer, JWT) | `/internal/v1/*` calls without a user | Calling service identity, target-specific audience, expiry, rotation, and endpoint allow-list |
| Webhook | route-specific `apiKey` header scheme | Provider callbacks | Provider signature, timestamp/replay window, raw-body verification, and delivery-id deduplication |

For a user request, the gateway verifies the user-service token and forwards the
original bearer token. The owning service verifies it again. Neither hop trusts
`userId`, event role, or membership headers supplied by the client. Event roles
are resolved against the root event as required by ADR-001.

A service token never silently impersonates a user. An internal endpoint that
acts on behalf of a person requires an explicit, audited actor field defined by
that endpoint. Network location and a shared global secret are not auth tiers.
Optional auth (`security: [{}, { userBearer: [] }]`) requires its own ADR because
it changes caching, privacy, and response semantics.

## Request IDs

`X-Request-ID` is required on every response and propagated through every
synchronous downstream call, log, trace, outbox record created by the request,
and error envelope.

1. The gateway accepts a caller value only when it matches
   `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; otherwise it creates a UUID with
   `crypto.randomUUID()`.
2. The gateway records that value in context, returns it, and forwards it
   unchanged. It does not append service names.
3. A service preserves a valid incoming value and generates one when called
   directly without it.
4. Each async job gets its own request ID and retains `causationRequestId` for
   the request that wrote the outbox event.

Unbounded or control-character-bearing caller values are never logged. Trace
IDs may be recorded alongside request IDs but do not replace this public
support handle.

## Pagination

Mobile-facing and cross-service collections use opaque cursor pagination, not
page numbers or offsets:

```http
GET /v1/events/evt_01/feed?limit=50&cursor=eyJ2IjoxLC4uLn0
```

```json
{
  "items": [
    { "id": "fed_01", "kind": "message", "createdAt": "2026-07-18T08:15:00Z" }
  ],
  "pageInfo": {
    "nextCursor": "eyJ2IjoxLC4uLn0",
    "hasMore": true
  }
}
```

- `limit` defaults to 50 and is constrained to 1..200.
- `cursor` is optional on the first page and opaque to consumers.
- `nextCursor` is required and nullable; it is `null` exactly when `hasMore` is
  false.
- Each operation documents a deterministic keyset order with an ID tie-breaker,
  for example `createdAt DESC, id DESC`.
- A cursor is versioned and bound to the operation, normalized filters, sort,
  principal/event scope, and last key. It is signed or resolved server-side so
  a client cannot cross an authorization boundary by editing it.
- A malformed or mismatched cursor returns `400 CURSOR_INVALID`. A deliberately
  expired change-history cursor returns `410 CURSOR_EXPIRED` plus a safe
  bootstrap link or instruction.
- The offline sync change cursor may use a monotonic service sequence, but it
  uses the same opaque field and error behavior. A search engine cursor is not
  exposed as Crew's durable sync cursor.

## Idempotency

Every operation declares `x-idempotency: required | natural | none`.
State-changing mobile `POST` and command-style `PATCH` operations are
`required`. A `PUT` or `DELETE` may be `natural` only when repeating it is
tested to produce the same desired state. Read-only operations are `none`.

For `required` operations:

- mobile sends `Idempotency-Key`, 8..128 characters matching
  `^[A-Za-z0-9][A-Za-z0-9._:-]+$`; a UUID is the normal choice;
- the gateway validates and forwards the key but never owns the result;
- the owning service scopes it by authenticated actor and `operationId`, and
  stores a fingerprint of method, normalized path/query, and canonical body;
- claiming the key, changing domain state, and writing the outbox are one local
  database transaction;
- the same key and fingerprint returns the original status, body, `Location`,
  and resource identity with `Idempotency-Replayed: true`;
- before disclosing a stored response, the owning service rechecks the current
  authorization needed for that specific status, body, and resource. A success
  for a still-readable resource requires current read access; manager-only or
  otherwise sensitive responses retain their stronger disclosure tier. This
  guard performs no mutation and does not replace fresh-command authorization;
- the replay has the current `X-Request-ID`; correlation IDs are not cached;
- the same key with a different fingerprint returns
  `409 IDEMPOTENCY_KEY_REUSED` and performs no work;
- a concurrent request for a claimed but unfinished key returns
  `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After`; and
- completed records remain available for at least 30 days. Operations with a
  permanent domain invariant, such as single-use invite redemption, also use a
  domain uniqueness constraint and do not rely only on expiry.

Malformed input, failed authentication, and failures before the key is claimed
do not consume the key. A 5xx response is not persisted as a successful
idempotent result. Offline sync mutations additionally carry a stable
`clientMutationId`; HTTP idempotency protects the batch request while the event
service deduplicates every mutation independently.

## Generated clients and downstream pins

The gateway consumes a committed, pinned OpenAPI document for each downstream
service. A pin contains the producer service, `info.version`, source commit,
and SHA-256 digest. Updating a pin is an explicit reviewable command; CI and
runtime do not fetch the latest live document.

From each pin, `openapi-typescript` generates TypeScript operations and models.
A standard fetch runtime generates or exposes methods keyed by `operationId`.
The only handwritten wrapper concerns base URL, bearer forwarding, service
credentials, request ID, timeout/abort policy, and telemetry. It does not
redeclare request or response bodies.

The mobile app consumes only a client generated from the gateway's committed
public document. For React Native, the canonical package is a generated
TypeScript client. If Crew chooses separate Swift or Kotlin apps, their modules
are generated from the same pin using a repository-pinned generator version;
no platform gets an independently interpreted model.

Generated files have a header that names the source document and generator
version. They are never edited by hand. A producer change follows this order:

1. change route schema and implementation together;
2. regenerate and review the producer document;
3. pass compatibility gates and publish the document artifact;
4. update the gateway pin and regenerate its downstream client;
5. change gateway composition and regenerate its public document; and
6. regenerate the mobile client before merging the consumer change.

This order allows additive producer deployment before consumer cutover and
keeps rollback possible. Gateway requests use generated downstream clients;
mobile never imports a downstream-service client.

## Contract versioning and compatibility

The URL contains the API major (`/v1`, `/internal/v1`). `info.version` is SemVer
for the document:

- patch: descriptions, examples, or corrected metadata with no runtime change;
- minor: additive compatible operations or optional fields; and
- major: any consumer-breaking behavior, served under a new major path.

Breaking changes include removing or renaming a path, field, status, error
code, or operation ID; adding a required input; making optional output absent;
changing nullability, type, format, units, ordering, cursor, or idempotency
semantics; narrowing validation; expanding a closed enum; or strengthening
security for an existing operation. Existing fields never acquire a new
meaning.

An incompatible replacement is added beside the old operation. The old one is
marked `deprecated: true` and returns standard `Deprecation`, `Sunset`, and
`Link` headers. Removal requires both at least 180 days' notice and telemetry
showing that no supported mobile version uses it. Emergency security removal
requires an incident decision and a forced-upgrade plan.

Servers may deploy before apps and apps may remain offline, so consumers ignore
unknown object properties. Enum expansion is compatible only when the schema
explicitly models an unknown fallback; otherwise it requires a new field or
major contract. The gateway pins exact downstream minor versions and upgrades
them deliberately.

## CI drift and compatibility gates

Every service exposes these non-interactive scripts with repository-pinned tool
versions:

| Script | Required behavior |
|---|---|
| `bun run contract:export` | Deterministically generate `openapi/openapi.json`; no timestamps or environment-specific server URLs |
| `bun run contract:lint` | Validate OpenAPI 3.1 plus Crew policy rules |
| `bun run contract:check` | Export to a temporary file and fail on a diff from the committed document |
| `bun run contract:breaking --base <file>` | Use an OpenAPI compatibility diff against the target branch and fail on breaking changes |
| `bun run client:generate` | Regenerate all clients owned by that consumer from committed pins |
| `bun run client:check` | Regenerate to a temporary directory and fail on any generated-client diff |

The Crew policy linter fails when:

- the document is not OpenAPI 3.1 or is structurally invalid;
- an operation lacks a unique stable `operationId`, tag, success response, or
  explicit `security`;
- a documented JSON error does not reference `ErrorEnvelope`;
- a response omits the `X-Request-ID` header;
- a collection lacks the cursor envelope or deterministic-order description;
- a state-changing operation lacks a valid `x-idempotency` classification, or
  a `required` operation omits the header and 409 responses;
- a public gateway document exposes `/internal/*` or webhook paths;
- an example does not validate against its schema;
- generated output differs from its committed source;
- a downstream pin digest or generated gateway client differs from its lock;
  or
- the base comparison finds a breaking change in an existing major.

Route tests also prove at least one success and every declared domain-error
branch for each operation. Shared contract tests send invalid input, missing
auth, an idempotent replay, idempotency-key misuse, pagination continuation,
and a forced unhandled exception; response status, body, headers, and schema
must agree. A test that only snapshots the OpenAPI JSON is not sufficient.

CI runs export/check, policy lint, breaking diff, route tests, and client drift
checks in the producer. Gateway CI additionally checks every downstream lock.
Mobile CI additionally checks its gateway-client pin. A release artifact embeds
the service commit and contract version so production evidence can be matched
to the reviewed document.

## Acceptance evidence

| Requirement | Decision evidence | Executable acceptance evidence once the service scaffold lands |
|---|---|---|
| One error envelope across services | Error contract and common status table | Shared invalid/auth/conflict/500 contract tests validate `ErrorEnvelope` and matching `X-Request-ID` |
| Stable code-first OpenAPI 3.1 | Contract source, route example, operation-ID registry | `contract:export`, `contract:lint`, and operation-ID comparison pass |
| Explicit auth tiers | Authentication-tier matrix and double-verification request path | Policy lint finds explicit security on every operation; auth tests cover public, user, service, and webhook routes |
| Request correlation | Request-ID propagation rules | Gateway-to-service integration test proves the same valid ID in both logs, response header, and error body |
| Mobile-safe collection contract | Cursor pagination rules and examples | Multi-page, invalid-cursor, cross-scope cursor, and expired-sync-cursor tests pass |
| Offline-safe retries | Idempotency state machine and retention rules | Concurrent replay, changed-fingerprint, post-commit network-failure, and per-mutation dedupe tests pass |
| Gateway pins downstream contracts | Pin metadata and producer-to-consumer sequence | Pin digest check and `client:check` pass without a working-tree diff |
| Generated mobile contract | Mobile consumes only gateway public spec | Mobile `client:check` passes and no downstream-service import exists |
| Version and drift protection | SemVer, deprecation, compatibility, and CI gates | Base-branch breaking diff rejects a fixture for every listed breaking-change class |

The Swiss Activities files inspected as concrete precedent were
`api-gateway/src/server.ts`, `user-service/src/server.ts`, both services'
`core/middleware/request-id.ts`, `core/middleware/error-handler.ts` and common
schemas, plus `api-gateway/src/core/contracts/README.md` and its
`bapi:codegen`/`bapi:check` scripts. Crew deliberately strengthens that baseline
rather than copying its historical inconsistencies such as absent operation
IDs, mixed pagination styles, or handwritten downstream response interfaces.

## Consequences

The service route, reviewed OpenAPI artifact, gateway pin, and mobile client can
no longer drift silently. Installed apps receive predictable errors and retry
semantics, and services can deploy additively without sharing a database.

The cost is more disciplined schema work and generated diffs on every contract
change. Breaking improvements take longer because old mobile versions remain in
the wild. That cost is accepted: Crew's offline-first mobile experience depends
on compatibility across time, not only across the services currently running.
