# `@crew/mobile-client`

Typed, dependency-free mobile client for the Crew API Gateway.

## Contract

The package byte-pins `services/api-gateway/openapi/openapi.json` and generates:

- `src/generated/gateway.ts`: request, response, and component types;
- `src/generated/routes.ts`: the deterministic 81-operation runtime manifest,
  allowed success statuses/media types, and validation schemas;
- `contracts/contract.lock.json`: SHA-256, byte count, version, and source provenance.

Never edit generated files. Regenerate and verify them with:

```sh
bun run generate
bun run generate:check
```

`generate:check` fails when the producer contract, pin, types, manifest, digest, or
provenance differ.

## Client

The app supplies its secure session persistence through `SessionStore`:

```ts
import { GatewayClient, type SessionStore } from "@crew/mobile-client";

const client = new GatewayClient({
  baseUrl: "https://api.example.com",
  sessionStore: secureSessionStore satisfies SessionStore,
});

const event = await client.request("eventsGet", {
  path: { rootEventId, eventId },
});
```

`SessionStore.compareAndSet(expected, replacement)` must atomically compare the
current user ID, access token, and refresh token before replacing or clearing it.
This is the only persistence mutation the client uses, so an old request cannot
overwrite or clear a newly selected account.

Request path, query, headers, body, and success data are inferred from the pinned
OpenAPI operation. The client owns `Authorization`, `X-Request-ID`, JSON content
type, and default idempotency keys.

Authenticated responses use a token-and-user-bound session check. `401`
responses use a single-flight refresh.
Delayed old-token responses reuse an already rotated session. An account switch
can neither consume nor be overwritten by the previous account's refresh. A
refresh failure invalidates the rejected access token locally before clearing the
persistent store, so even a failed store clear remains fail-closed.

Gateway origins require HTTPS. For local development only, HTTP is accepted on
exact loopback hosts `localhost`, `127.0.0.1`, and `[::1]`. Redirects fail closed,
so credential-bearing bodies never follow a 307 or 308 to another origin.

Each success must match the operation's declared status, media type, non-empty
JSON requirement, and generated JSON-schema subset before typed data is returned.

The timeout covers both fetch and response-body consumption. Caller aborts remain
separate from timeouts and do not cancel a shared refresh flight.

`GatewayClientError` and `GatewayDiagnostic` contain only operation, status,
validated request ID, a finite allowlisted gateway error code, retryability, and
a bounded numeric `Retry-After`. Unknown codes map to `http_error`; tokens, URLs,
raw response bodies, and server messages are never retained.

## Product analytics

`ProductAnalytics` accepts only four typed funnel events with enum-only
properties. It binds every event to a currently authenticated
`GatewaySessionSubject` and emits only the stable internal `usr_*` ID. Invite or
access tokens, email addresses, message text, request bodies, feedback IDs, and
diagnostics have no fields in this contract; unexpected events, properties, and
values are rejected with a value-free error.

The app supplies a first-party sink. Sink failures are isolated from product
behavior and return `"dropped"`; this package has no analytics vendor SDK and no
database access.

```ts
const analytics = new ProductAnalytics({ session: client, sink });
const subject = await client.sessionSubject();

if (subject) {
  await analytics.capture(subject, {
    name: "organizer_start",
    properties: { vertical: "team_event", platform: "ios" },
  });
}
```

## Gates

```sh
bun run lint
bun run typecheck
bun test
```

Root CI installs the workspace from `bun.lock` with `--frozen-lockfile` and runs
all four gates through `bun run check:mobile-client` before deployment.
