# Crew staging deployment and rollback

Crew staging is a greenfield Docker Compose deployment. It does not import,
copy, or migrate data from the retired Crew project. The normal User and Event
schema migrations only initialize or advance Crew's own new PostgreSQL
databases.

The executable release path is `infra/staging/host-release.sh`. It accepts one
literal action and one full Git SHA:

```sh
sudo infra/staging/host-release.sh deploy <40-character-main-sha>
sudo infra/staging/host-release.sh rollback <40-character-previous-sha>
```

The executor supports only the `crew-next-staging` Compose project and the
public origins `https://crew-haus.com` and
`https://staging.crew-haus.com`. Run it as root on the approved single staging
host. The host needs Git, Docker Engine with Compose, Caddy, OpenSSL, curl,
`flock`, and GNU coreutils.

## Immutable inputs

Before any service is changed, the executor:

1. requires a full lowercase Git SHA;
2. clones that exact revision into `/opt/crew-new/releases/<sha>`;
3. rejects a dirty or mismatched existing checkout;
4. builds SHA-tagged images with the Git revision as an OCI label;
5. pins all third-party runtime images by digest.

Secrets are generated once in `/opt/crew-new/shared/environment` with mode
`0600`. The Typesense bootstrap admin key and the separately generated
search-only key are different. The executor provisions the latter through the
Typesense key API with only `documents:search` on `crew_places.*`; only that
key reaches Event API, while the admin key remains confined to Typesense
bootstrap, key provisioning, and the bounded reindex job. Secret values are
never written to Git or release records.

## First greenfield deployment

The first deploy starts fresh PostgreSQL, Redis, MinIO, Typesense, provider
sink, and internal TLS containers. It then runs, in order:

1. JWT bootstrap;
2. User and Event schema initialization;
3. least-privilege runtime grants;
4. MinIO bootstrap;
5. User, Event, worker, Gateway, and web runtimes;
6. the bounded Belek golf import and Typesense reindex;
7. private and public smoke checks.

The smoke contract requires:

- Gateway readiness and OpenAPI 3.1 over public TLS;
- the customer-visible Crew web marker;
- MinIO and Typesense readiness over TLS;
- API-only golf-tour and team-event fixture bootstraps;
- a real feedback attachment upload, finalize, bind, and private download/hash
  round trip.

The executor never runs `docker compose down`, removes a volume, drops a
database, or restores legacy data.

## Release evidence

After all smoke checks pass, the executor writes a mode-`0600` JSON record under
`/opt/crew-new/shared/records`. It binds:

- the code release SHA;
- the active database release SHA;
- the runtime grant SHA-256;
- a deterministic database-compatibility SHA-256 covering both migration
  directories and `infra/postgres/grant-runtime.sql`;
- a runtime-infrastructure compatibility SHA-256 covering the Compose
  definitions, provider sink, custom Redis image/startup, and internal TLS
  configuration;
- exact local image IDs for Gateway, User, Event, web, provider sink, custom
  Redis, and internal TLS;
- public and mobile Gateway origins;
- the executed smoke checks;
- the availability state of provider-backed enrichment.

The active state files and `current-record` pointer must agree with that record.
A mismatch fails closed before a later deploy or rollback.

## Rollback compatibility

Rollback changes only the code/runtime images and configuration selected by
the compatible target release. It does not reverse migrations, grants, or data.

The current executor deliberately supports only the smallest provably safe
case: the previous code, current database release, and target release must have
identical database-compatibility, runtime-grant, and runtime-infrastructure
digests. A forward deploy with an existing release writes an immutable
`identical-database-and-runtime-contract` proof for the exact
`fromReleaseId`/`toReleaseId`/`databaseReleaseId` tuple before any public route
or runtime is changed.

If migrations, grants, or runtime infrastructure differ, the forward deploy
stops with:

```text
Forward deploy changes the database or runtime infrastructure contract; richer rollback evidence is required
```

That path must not be bypassed. A future schema-changing release needs a richer
CI compatibility proof that starts the previous Gateway, APIs, and workers
against a clone migrated and granted by the target release.

Before rollback mutates Caddy, images, or services, it validates:

1. the current release record;
2. the active database release checkout;
3. the stored and recomputed grant digest;
4. the stored and recomputed database-compatibility digest;
5. the stored and recomputed runtime-infrastructure digest;
6. the immutable proof written by the forward deploy.

Only then does it recreate the target release's custom Redis, provider sink,
and internal TLS containers without removing their volumes. It verifies the
Typesense search-only key, then restores Gateway, followed by Event API/workers
and User API/workers, runs the same smoke contract, and records the resulting
code release with the still-current database release.

## Public association files and optional providers

Until real Apple Team ID and Android signing fingerprints are supplied,
`/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` return `404`. Placeholder associations are never
published.

Provider-backed place enrichment remains disabled without a real provider
worker. Create/retry requests fail with the documented retryable `503`; exact
completed idempotency replays remain available. E-mail and push delivery stay
inside the provider sink until approved providers are configured.

## Verification

Repository checks:

```sh
bash -n infra/staging/host-release.sh
bunx biome check infra/staging-config.test.ts
bun test infra/staging-config.test.ts
```

After a deploy or rollback, verify externally:

```sh
curl --fail https://crew-haus.com/
curl --fail https://staging.crew-haus.com/internal/ready
curl --fail https://staging.crew-haus.com/docs/openapi.json
curl --fail https://staging.crew-haus.com:8444/minio/health/ready
```

Inspect the active record and Compose state on the host. Source, CI, or image
timestamps alone are not live-deployment proof.
