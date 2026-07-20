# Local platform development

This Compose stack is a local-development environment for the Crew gateway,
user/event services and their workers. It starts with one command and keeps all
published ports on the host loopback interface.

> **Not for production.** The stack uses fixed fallback development secrets,
> plain HTTP, single-node stateful services and local provider emulation. It has
> no TLS, backup, replication, external secret manager or production-grade
> network policy. Never deploy `compose.yaml` or its credentials to a shared or
> production environment.

## Start

Docker Desktop (or Docker Engine with the current Compose plugin) is required.
From the repository root:

```sh
docker compose up --build --wait
```

The fallback values make a clean checkout reproducible. To use private local
credentials, copy `.env.example` to the ignored `.env` file and replace every
secret before the first start:

```sh
cp .env.example .env
docker compose up --build --wait
```

`--wait` returns only after the long-running services with healthchecks report
healthy. The one-shot JWT, migration, database-grant and MinIO bootstrap
containers must exit successfully before their dependants start.

The local endpoints are:

| Component | Host endpoint |
| --- | --- |
| API gateway | `http://127.0.0.1:3000` |
| User API | `http://127.0.0.1:3001` |
| Event API | `http://127.0.0.1:3002` |
| PostgreSQL | `127.0.0.1:5433` |
| Rate-limit Redis | `127.0.0.1:6380` |
| Typesense | `http://127.0.0.1:8108` |
| MinIO S3 API | `http://crew-minio.localhost:9000` |
| MinIO console | `http://127.0.0.1:9001` |

Every published port is explicitly bound to `127.0.0.1`. The MinIO container
also has the internal network alias `crew-minio.localhost`; this makes presigned
URLs use the same hostname inside Compose and on the host without making the
bucket public.

## What starts

- `api-gateway`, `user-api` and `event-api`
- magic-link, push, attachment and event-notification workers
- a private local magic-link/push provider sink
- PostgreSQL 17 with separate `crew_user` and `crew_event` databases
- Redis 8.8 with AOF-backed, service-owned abuse-control namespaces
- Typesense 30.2
- private MinIO storage with an API identity, a narrower attachment-worker
  identity, a one-shot bucket/policy bootstrap, a 256 MiB hard storage quota,
  one-day quarantine expiry and authenticated bucket API metrics

The PostgreSQL admin and migration-owner credentials never reach runtime APIs
or workers. Each API has its own database login; each worker has a task-scoped
login and only receives the table rights its repository needs. Migrations run
with the database-owner logins, record checksums in service-owned migration
tables and use advisory locks. `db-grants` runs only after both migration jobs
complete.

`jwt-bootstrap` generates an RSA-2048 PKCS#8 private key and SPKI public key in
the `user_jwt_keys` volume. The User API mounts both files read-only using
`JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH`. Event API and gateway do not
mount the private key; they obtain the same public key through the User API's
`/.well-known/jwks.json` endpoint.

Gateway request limits and User-service authentication limits share one local
Redis process but not one authority. `crew_gateway` can access only
`crew:gateway:rate:v1:*`; `crew_user` can access only
`crew:user:rate:v1:*`. Both identities start from `-@all` and receive only the
commands required by their atomic limiter script. The default Redis user is
disabled. Rate-limit keys and active-index members are HMAC-SHA256 digests, so
raw IP addresses, principals, email addresses and tokens are not stored.

The scripts use Redis server time, TTL-bound fixed windows and bounded active
indexes. A full index rejects a new identity without evicting an active client.
Redis unavailability or a command timeout fails closed with a short, generic
`503` response; exhausted limits retain the public `429` plus `Retry-After`
contract. AOF with `appendfsync always` retains accepted counters across a
process restart. This single-node local durability is not replication, backup
or a production availability design.

Production configuration must use `rediss://`, authenticated service-specific
ACL credentials and unique non-development `RATE_LIMIT_KEY` values. The local
plain-Redis URLs and fallback secrets are intentionally rejected in production.

The provider sink is network-internal. It enforces separate delivery and
fixture bearer credentials, valid JSON and streaming body limits. Push payloads
are discarded. A delivered magic-link token is held only in a bounded in-memory
map until the local fixture client consumes it through its separately authorized
one-time endpoint; it is never written to disk or included in logs. Logs contain
only the delivery kind—never caller-controlled headers, email addresses, magic
links, tokens or push payloads.

MinIO keeps `crew-event-development` private: anonymous object access is
disabled and neither service policy grants ACL writes. The Event API signs an
exact multipart POST policy for the object key, byte count, media type and
SHA-256 checksum. Objects first land below `quarantine/`; the attachment worker
alone can read, delete or copy them into the committed namespace after its
validation succeeds. The lifecycle rule expires only the quarantine prefix
after one day. Lifecycle execution is asynchronous, and the 256 MiB hard quota
is a storage backstop rather than an immediate per-request upload limit; the
signed POST policy remains the ingress boundary.

Bucket API metrics are exposed at
`/minio/metrics/v3/bucket/api/crew-event-development` with JWT authentication.
The bootstrap checks that MinIO can issue a scoped bearer token but deliberately
does not print or persist it. Generate a fresh local operator token when needed:

```sh
docker compose run --rm --entrypoint /bin/sh minio-bootstrap -c \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc admin prometheus generate local api --bucket crew-event-development --api-version v3'
```

## Health, logs and migrations

Inspect all containers, including successful one-shot jobs:

```sh
docker compose ps --all
docker compose logs jwt-bootstrap user-migrate event-migrate db-grants minio-bootstrap
```

Probe the public development services:

```sh
curl --fail http://127.0.0.1:3000/internal/ready
curl --fail http://127.0.0.1:3001/internal/ready
curl --fail http://127.0.0.1:3002/internal/ready
curl --fail http://127.0.0.1:8108/health
curl --fail http://127.0.0.1:9000/minio/health/ready
```

Follow application and worker output:

```sh
docker compose logs --follow api-gateway user-api event-api
docker compose logs --follow magic-worker push-worker attachment-worker notification-worker recap-retention-worker
```

When a new migration is added, remove only the old one-shot containers and
start normally. Existing checksummed migrations are not applied again:

```sh
docker compose rm --force user-migrate event-migrate db-grants
docker compose up --build --wait
```

## Stop, reset and rotate secrets

Stop containers while retaining named data volumes:

```sh
docker compose down
```

The following full reset permanently deletes the local Postgres databases,
rate-limit windows, MinIO objects, Typesense data and generated JWT key pair:

```sh
docker compose down --volumes --remove-orphans
```

PostgreSQL and MinIO initialization credentials are applied when their named
volumes are created. To rotate those values, update `.env`, perform the full
volume reset above, and start again. Generate URL-safe password material with,
for example, `openssl rand -hex 32`.

Payload-encryption and service-auth keys must decode to exactly 32 bytes. A
URL-safe value can be generated with:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

To rotate only the generated RSA development key while keeping database and
object data, stop the stack, remove that one named volume and restart all
consumers so their JWKS caches are empty:

```sh
docker compose down
docker volume rm crew-new_user_jwt_keys
docker compose up --build --wait
```

## Import worldwide golf candidates

The candidate tool reads one bounded OpenStreetMap tile through Overpass and
submits only stable IDs, names, coordinates and ODbL provenance to the existing
service-authenticated Event API. The Compose defaults cover Belek; set the four
`PLACE_GOLF_IMPORT_*` location values in `.env` for another tile. Each run makes
one bounded source request, accepts at most 100 named courses, and expires the
source snapshot after 30 days unless refreshed.

Import, then atomically publish the current candidate feed to search:

```sh
docker compose --profile tools run --rm place-golf-import
docker compose --profile tools run --rm place-search-reindex
```

Search results are immediately `pending`; no rich place and no AI request is
created until a user selects a candidate. Stable provider identities use the
OpenStreetMap element type and ID. Data attribution and license details follow
[OpenStreetMap copyright](https://www.openstreetmap.org/copyright), and the
bounded query uses the documented
[Overpass QL bounding box and output limit](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL).

## Create the local API fixture

After a fresh stack is healthy and the Belek candidate import plus search
reindex above have completed, one command signs in three deterministic local
accounts through the real magic-link contract and creates a Turkey golf-tour
event from the versioned `golf-tour` template:

```sh
docker compose run --rm fixture-bootstrap
```

The golf scenario resolves the five pinned Belek OpenStreetMap candidate IDs
through gateway search before copying the approved names and coordinates into
root-scoped event places. It creates and publishes eight events, including five
golf rounds, plus flight, shared transfers, seven-night lodging, two dinners and
five course plans across eleven itinerary items. The owner creates email-bound
organizer and participant invitations; both local users redeem them through the
public gateway. The final checks read all three memberships, sanitized invite
state, nine places, the complete event graph and a one-page owner sync bootstrap.
Every write is sent twice with the same idempotency key and must return an exact
replay, so the proof fails on duplicate creation or changed responses.

The fixture now proves the playable Golf sync path entirely through the public
gateway: the owner sends an exact 18-hole round with three eligible players and
a team through `golf.round.replace`, then the participant records a hole through
`golf.score.set` and pulls the private score plus shared leaderboard. Participant
bootstrap never receives the manager-only signed-handicap roster; owner
bootstrap does. No fixture code inserts rounds, players or scores directly into
PostgreSQL to bypass the service boundary.

The same client can create the non-travel team-event fixture without another
service or seed path:

```sh
docker compose run --rm -e CREW_FIXTURE_SCENARIO=team-event fixture-bootstrap
```

That scenario creates a one-day event tree for arrival, two workshops, lunch,
a team challenge, decisions and wrap-up. It persists the venue through the
place API, the ordered day through itinerary APIs, an owner membership and a
participant invitation through the root/membership/invitation APIs, and the
decision log through the feed API. The runner reads the owner membership back
before succeeding. Its only capability is validated `team` metadata; it never
adds travel or golf fields.

The tool sends every product request through the public gateway, uses stable
idempotency keys and client event IDs, verifies exact replay responses, reads
the resulting event graph back and prints only the scenario, root event ID and
event count. It never prints user IDs, email addresses, access, refresh or
magic-link tokens. Its only non-public call is a
separately authenticated, network-internal one-time consume request to the
local provider sink. Neither the client nor the sink has database credentials,
and no fixture code performs SQL or direct service-database mutation.

Each scenario uses its own deterministic user, resource IDs and idempotency
keys, so the golf and team fixtures can coexist. Exact replay is verified for
every write. Run each scenario once per fixture state; reset the documented
local volumes before rerunning that same scenario from its first magic-link
step. The fixture container has the Compose `tools` profile and is not started
by the normal `docker compose up` path. Its local-only guard rejects HTTPS,
non-local hosts or execution without `CREW_LOCAL_FIXTURE=1`.

## Pins and upstream references

All external images use immutable tag-plus-manifest-digest references. The Bun
application image uses the repository's Bun 1.3.9 runtime, a frozen root lockfile
and a single root-context `infra/Dockerfile`.

- Docker documents the `service_healthy` and
  `service_completed_successfully` dependency gates in
  [Control startup and shutdown order](https://docs.docker.com/compose/how-tos/startup-order/).
- The healthcheck syntax comes from the
  [Compose services reference](https://docs.docker.com/reference/compose-file/services/).
- Bun documents the official `oven/bun` image and root-context container build
  in [Containerize a Bun application](https://bun.sh/docs/guides/ecosystem/docker).
- The official PostgreSQL image documents `17.10-bookworm`, the PostgreSQL 17
  volume path and `/docker-entrypoint-initdb.d` behavior in
  [postgres on Docker Hub](https://hub.docker.com/_/postgres).
- Typesense documents image `typesense/typesense:30.2` and `/health` in
  [Updating Typesense](https://typesense.org/docs/guide/updating-typesense.html).
- MinIO documents the single-node S3-compatible container in
  [MinIO for Container](https://min.io/docs/minio/container/index.html), and its
  IAM-compatible least-privilege policies in
  [Access Control with Policy Management](https://docs.min.io/aistor/administration/iam/access/).
- The local MinIO server is pinned to the official
  [`RELEASE.2025-09-07T16-13-09Z`](https://github.com/minio/minio/releases/tag/RELEASE.2025-09-07T16-13-09Z)
  container. It is local-only and is not an approved production version; the
  later upstream
  [`RELEASE.2025-10-15T17-29-55Z` security release](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
  requires a source-built container.
- The native provider attestation uses MinIO's official
  [Darwin arm64 server checksum](https://dl.min.io/server/minio/release/darwin-arm64/minio.RELEASE.2025-09-07T16-13-09Z.sha256sum)
  and
  [Darwin arm64 mc checksum](https://dl.min.io/client/mc/release/darwin-arm64/mc.RELEASE.2025-08-13T08-35-41Z.sha256sum)
  manifests for those exact releases.
- Bucket creation uses the documented idempotent
  [`mc mb --ignore-existing`](https://docs.min.io/aistor/reference/cli/mc-mb/)
  path, and worker/API identities use documented
  [`mc admin policy attach`](https://docs.min.io/aistor/reference/cli/admin/mc-admin-policy/mc-admin-policy-attach/).
- Quarantine expiry, the hard bucket quota and private v3 telemetry use the
  documented [`mc ilm rule import`](https://docs.min.io/aistor/reference/cli/mc-ilm-rule/mc-ilm-rule-import/),
  [`mc quota set`](https://docs.min.io/aistor/reference/cli/mc-quota-set/) and
  [authenticated metrics](https://docs.min.io/aistor/operations/monitoring/metrics-and-alerts/)
  paths.
- Redis documents key-pattern and command allowlists in
  [ACL rules](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
  and AOF durability modes in
  [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
- The rate-limit image follows the pinned tag published in the official
  [Redis image manifest](https://github.com/docker-library/official-images/blob/master/library/redis).

## Current verification boundary

This host still had no `docker` executable on 2026-07-19, so Compose rendering,
container builds and a cold-start run remain unverified locally. ShellCheck was
also unavailable. Static Compose/CI parsing, `bash -n`/`sh -n`, Bun checks,
service config loaders, loopback/pin assertions and local PostgreSQL permission
tests are available.

The object-store provider boundary was additionally exercised against the exact
official Darwin arm64 binaries corresponding to the pinned container releases:
MinIO `RELEASE.2025-09-07T16-13-09Z` (SHA-256
`7c3b3039b76e55a1b80935848ed83998d5e8d317374f87851f46a019ff5c0aa4`)
and mc `RELEASE.2025-08-13T08-35-41Z` (SHA-256
`a877fd0c183409da9f20f9d6e1811987298bbbca1aa03428eebdffba79fb9445`).
Their official checksum files were verified before execution. A valid multipart
POST returned `204`; wrong byte count, media type, checksum and a requested
public ACL were rejected. Anonymous object and metrics reads returned `403`,
while an mc-issued bucket API token exposed non-zero POST totals, 4xx errors and
ingress bytes. MinIO read-back confirmed the one-day `quarantine/` rule and the
268,435,456-byte hard quota. This proves the pinned local provider behavior, not
the behavior of a different production S3 provider.

Before claiming fresh-checkout acceptance, a Docker-capable host must run:

```sh
docker compose config --quiet
docker compose build --pull
docker compose up --build --wait
docker compose ps --all
```

It must then verify every probe above, successful one-shot logs, worker
stability, private MinIO access, presigned upload/download behavior and a full
`down --volumes` then cold start. Until that evidence exists, `crew-paq.9.1`
must remain in progress.
