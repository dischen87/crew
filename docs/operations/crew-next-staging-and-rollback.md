# Crew staging deployment and rollback

Crew staging is a greenfield Docker Compose deployment. It does not import,
copy, or migrate data from the retired Crew project. The normal User and Event
schema migrations only initialize or advance Crew's own new PostgreSQL
databases.

The normal release path is the manually dispatched
`.github/workflows/crew-staging-release.yml`. It publishes six Linux/AMD64
images, records their literal GHCR digests in an artifact, and invokes the
reviewed `crew-next-staging` GitHub Environment. The Environment's dedicated
SSH key is restricted to `infra/staging/github-deploy-command.sh`, which
accepts only:

```text
deploy <current-main-40-sha> <base64-image-manifest>
redeploy <current-main-40-sha>
rollback <main-ancestor-40-sha>
resume-reset <reset-target-main-ancestor-40-sha> <github-actions-N>
resume-forward <forward-target-main-ancestor-40-sha>
abort-forward <forward-target-main-ancestor-40-sha>
```

The forced command fetches the current `main` controller and runs
`infra/staging/host-release.sh` with a clean environment. The executor supports
only the `crew-next-staging` Compose project and the public origins
`https://crew-haus.com` and `https://staging.crew-haus.com`. The approved
single staging host needs Git, Docker Engine with Compose, Caddy, OpenSSL,
curl, `flock`, and GNU coreutils.

A deploy requires the release SHA to remain the current `main` tip. If `main`
moves while images are publishing, rerun the workflow for the new tip.
After a rollback, select `reuse_stored_manifest` to forward-deploy that same
`main` revision without rebuilding or replacing its recorded image digests.

The one-time greenfield reset additionally requires `deploy=true`,
`reuse_stored_manifest=false`, `reset_staging_data=true`, and the exact active
release in `expected_current_staging_sha`. It remains behind the reviewed
`crew-next-staging` Environment. Do not advance `main` until the reset completes.
The audit-bound `resume-reset` command exists only to recover an already consumed
reset after `main` has advanced; it cannot authorize a new deletion.

## Immutable inputs

Before any service is changed, the executor:

1. requires a full lowercase Git SHA;
2. clones that exact revision into `/opt/crew-new/releases/<sha>`;
3. rejects a dirty or mismatched existing checkout;
4. validates the six-image manifest and stores it mode `0600`;
5. pulls only literal GHCR digests and checks their source and revision labels;
6. applies a final Compose override with `pull_policy: never`;
7. pins all third-party runtime images by digest.

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

After the greenfield baseline exists, a temporary upstream Overpass failure
retains and reindexes the existing catalog. The release still fails if that
verified index is empty; the first greenfield import never falls back.

The smoke contract requires:

- Gateway readiness and OpenAPI 3.1 over public TLS;
- the customer-visible Crew web marker;
- MinIO and Typesense readiness over TLS;
- API-only golf-tour and team-event fixture bootstraps;
- a real feedback attachment upload, finalize, bind, and private download/hash
  round trip.

Normal deploys and rollbacks never run Compose down, remove a volume, drop a
database, or restore legacy data. The explicitly approved reset below is the
only volume-removal path.

## Explicit staging data reset

The reset is an irreversible, staging-only greenfield operation. It stops only
the `crew-next-staging` Compose project, runs Compose down without `--volumes`,
and then explicitly removes exactly:

- `crew-next-staging_postgres_data`;
- `crew-next-staging_redis_rate_limit_data`;
- `crew-next-staging_minio_data`;
- `crew-next-staging_typesense_data`;
- `crew-next-staging_user_jwt_keys`.

This deletes all Crew staging users, events, migration state, rate-limit state,
attachments, search documents, JWT signing keys, and sessions. It does not
touch retired Crew or production data. No backup is taken because deletion of
the greenfield fixture data is explicitly authorized.

Before deletion, the executor requires the expected active SHA, validates the
current release evidence and exact Docker project labels, and writes a
mode-`0600` consumed authorization record plus
`/opt/crew-new/shared/reset-in-progress`. The record binds the GitHub run ID,
From/To SHAs, manifest and contract hashes, prior release record, environment
hash, and the five volume creation records. Stored manifests cannot replay the
reset through a normal redeploy. A second reset ID cannot reset again; an
interrupted run can resume only with the recorded reset ID, From/To evidence,
and stored manifest digest. Ambiguous resource scope fails closed.

The forced-command SSH key can present this one-time intent, so enabling the
path temporarily expands that key from deploy authority to staging-data reset
authority. The normal workflow still requires the reviewed Environment, but the
host cannot independently prove that approval. This is accepted only for the
authorized one-time reset; the permanent consumed record removes the reset
authority after it starts.

The reset preserves `/opt/crew-new/shared/environment`, TLS, immutable release
records, compatibility proofs, image manifests, and all release checkouts. It
clears only active pointers after the five volumes and project resources are
gone, then performs the normal fresh bootstrap, migrations, grants, import,
reindex, image verification, and smoke contract. Staging and the public preview
are unavailable during this bounded rebuild. The in-progress marker is removed
only after a `reset-deploy` record and the new active pointers are durable.
The completion record also binds the immutable reset release-record filename,
SHA-256, and reset fields.

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
- the canonical image-manifest and generated Compose-override SHA-256;
- the database-lineage ID and, for the one-time reset, reset ID and reset-audit
  SHA-256;
- exact GHCR digest references and secondary local image IDs for Gateway, User,
  Event, web, infrastructure tools, custom Redis, and internal TLS;
- public and mobile Gateway origins;
- the executed smoke checks;
- the availability state of provider-backed enrichment.

Each release gets a mode-`0600` `active-<sha>.record` pointer to its immutable
record before `current-release` is atomically switched. Validation derives the
database, lineage, grant, and contract state from that SHA-specific record, so a
crash before the final switch leaves the prior release self-consistent and
retryable. The legacy active state files remain operational diagnostics rather
than the commit point. A record mismatch fails closed before a later deploy or
rollback.

The first greenfield baseline was recorded on 2026-07-26 for
`b9e7d56d579973d9851188d35992d9ca69243f41`. It contains only the
`crew-next-staging` Compose project with fresh dedicated volumes: 15 persistent
services, seven successful bootstrap jobs, 10 imported golf place candidates,
and isolated smoke fixtures. No retired Crew data was imported or migrated.

## Rollback compatibility

Rollback changes only the code/runtime images and configuration selected by
the compatible target release. It does not reverse migrations, grants, or data.

The reset starts a new database lineage and writes no `previous-release`.
Rollback to a commit before the reset boundary is rejected before Caddy,
containers, or routes are changed. Later compatible releases may roll back only
within the new lineage.

The executor supports two explicit cases. The normal case requires identical
database-compatibility, runtime-grant, and runtime-infrastructure digests. It
writes an immutable `identical-database-and-runtime-contract` proof for the
exact `fromReleaseId`/`toReleaseId`/`databaseReleaseId` tuple before any public
route or runtime is changed.

An additive transition may instead carry a
`previous-runtime-on-target-contract` proof in the immutable image manifest.
After requiring successful Crew CI, the release job must have started the
previous Redis, provider sink, Gateway, both APIs, all five existing workers,
fixture bootstrap, and web against a fresh database migrated and granted by the
target release. It checks every running container's local image ID, the previous
web marker, and both fixture scenarios. The manifest binds the exact previous
and target SHAs, target database/grant digests, both runtime-infrastructure
digests, the exact tested-service list, the successful release-workflow run ID,
`outcome: passed`, and all six immutable previous Crew image references. The
host recomputes every digest, loads the previous release's stored manifest, and
requires all six image references to match exactly before it writes the
rollback proof.
Dispatch that transition with `compatibility_from_sha` set to the exact active
staging SHA; leave reset, resume, and stored-manifest inputs disabled.

If migrations, grants, or runtime infrastructure differ, the forward deploy
stops with:

```text
Forward deploy changes the database or runtime infrastructure contract; richer rollback evidence is required
```

That path must not be bypassed for any transition without the exact CI proof.
The proof does not claim that changed contracts are identical.

Before target migrations run, the host stores a mode-`0600`
`forward-in-progress` intent bound to the exact from/to SHAs, target manifest,
and compatibility proof. After migrations and grants succeed, but before the
target runtime starts, it commits an auditable
`target-database-previous-runtime` release record. A failure may therefore be
resumed only with the same transition and manifest by selecting
`forward_recovery=resume`. If the target runtime cannot be made healthy,
`forward_recovery=abort` restores and smokes the proven previous runtime,
records and activates it against the active database release, and only then
removes the marker. Because the intent precedes migrations, abort first
idempotently completes the target migrations and grants and records the target
database boundary when that boundary is not yet durable. Both recovery modes
reuse the host-stored target manifest, so an interrupted transition remains
recoverable after `main` advances.
Rollback is rejected while the intent exists, and a staging reset is rejected
rather than silently superseding it.

Before rollback mutates Caddy, images, or services, it validates:

1. the current release record;
2. the active database release checkout;
3. the stored and recomputed grant digest;
4. the stored and recomputed database-compatibility digest;
5. the stored and recomputed runtime-infrastructure digest;
6. both releases' stored image-manifest digests;
7. the immutable proof written by the forward deploy, including both manifest
   digests, database lineage, tested services, release-workflow run, and result.

Only then does it recreate the target release's custom Redis, provider sink,
and internal TLS containers without removing their volumes. It verifies the
Typesense search-only key, then restores Gateway, followed by Event API/workers
and User API/workers, runs the same smoke contract, and records the resulting
code release with the still-current database release.

## Public association files and optional providers

The Apple association publishes the verified Swiss Activities Team ID
`WFSHGY54TA` for `app.crew.next` as JSON without redirects. The Android
`/.well-known/assetlinks.json` route returns `404` until the real release
signing fingerprints are supplied. Placeholder associations are never
published.

Android Release signing accepts only the complete external Gradle-property set
`crewReleaseStoreFile`, `crewReleaseStorePassword`, `crewReleaseKeyAlias`, and
`crewReleaseKeyPassword`; a partial set fails configuration. Supply them via
`ORG_GRADLE_PROJECT_*` environment variables and keep the keystore outside Git.
The `releaseEvidence` variant explicitly carries no production signing config.

The secure Android handoff is:

1. register `app.crew.next` in Play Console, enable Play App Signing, and keep
   the separate upload keystore in the approved secret manager;
2. inject the four `ORG_GRADLE_PROJECT_crewRelease*` values only into the
   approved bundle job and verify the resulting AAB signature;
3. copy the SHA-256 **app signing key certificate** fingerprint from Play
   Console, not the local upload-key fingerprint; include every certificate
   that still signs installs during a signing-key upgrade;
4. add the uppercase, colon-delimited fingerprints for `app.crew.next` to
   `apps/web/public/.well-known/assetlinks.json`, change the Caddy and staging
   contracts from fail-closed `404` to direct `200 application/json`, then
   deploy through the reviewed Environment;
5. reverify the domain on a physical Android device and exercise every
   cold/warm/restart link journey before Release acceptance.

For iOS, Xcode uses automatic signing for Team `WFSHGY54TA`; the Developer
account must still register `app.crew.next` with Associated Domains and issue
the matching distribution profile. A valid local certificate without that
profile is not a signed-device or App Store artifact.

### Optional place-enrichment worker

Provider-backed place enrichment is default-off. The generated external,
root-owned mode-`0600` environment contains
`EVENT_ENRICHMENT_ENABLED=false`; no provider credential belongs in Git, an
image, a workflow artifact, or a release record. Create/retry requests fail
with the documented retryable `503` while disabled, and exact completed
idempotency replays remain available.

After provider, privacy, and legal approval, populate every variable below in
`/opt/crew-new/shared/environment` and change the flag to `true`:

```text
EVENT_DB_ENRICHMENT_WORKER_PASSWORD
EVENT_ENRICHMENT_WORKER_POLL_INTERVAL_MS
EVENT_ENRICHMENT_WORKER_LEASE_MS
EVENT_ENRICHMENT_PIPELINE_VERSION
EVENT_ENRICHMENT_LLM_MODEL
EVENT_ENRICHMENT_PROMPT_VERSION
EVENT_ENRICHMENT_MAX_ATTEMPTS
EVENT_ENRICHMENT_MAX_EXA_CALLS
EVENT_ENRICHMENT_MAX_LLM_CALLS
EVENT_ENRICHMENT_MAX_INPUT_TOKENS
EVENT_ENRICHMENT_MAX_OUTPUT_TOKENS
EVENT_ENRICHMENT_MAX_COST_MICROS
EVENT_ENRICHMENT_PROVIDER_TIMEOUT_MS
EVENT_ENRICHMENT_MAX_RESPONSE_BYTES
EVENT_ENRICHMENT_EXA_BASE_URL
EVENT_ENRICHMENT_EXA_API_KEY
EVENT_ENRICHMENT_EXA_MAX_RESULTS
EVENT_ENRICHMENT_EXA_MAX_COST_MICROS_PER_CALL
EVENT_ENRICHMENT_LLM_URL
EVENT_ENRICHMENT_LLM_ALLOWED_ORIGIN
EVENT_ENRICHMENT_LLM_API_KEY
EVENT_ENRICHMENT_LLM_MAX_OUTPUT_TOKENS_PER_CALL
EVENT_ENRICHMENT_LLM_INPUT_COST_MICROS_PER_MILLION
EVENT_ENRICHMENT_LLM_OUTPUT_COST_MICROS_PER_MILLION
EVENT_ENRICHMENT_MAX_EVIDENCE_CHARACTERS
EVENT_ENRICHMENT_BASE_BACKOFF_MS
EVENT_ENRICHMENT_MAX_BACKOFF_MS
```

An enabled release with a missing or duplicate value fails before checkout,
image pulls, Caddy, containers, or database jobs change. Deployment then starts
the worker from the release's exact Event Service digest, without a host port,
clears any stale singleton heartbeat, and requires a current
`staging-place-enrichment-<release-sha>` database heartbeat before starting
the API runtimes. The release record reports `enabled-worker-healthy` only
after that gate. Disabled releases remove the worker and heartbeat, set its
database role to `NOLOGIN` with no stored password, and report
`disabled-no-provider-worker`.

After the initial gate, failure cleanup remains armed through smoke checks,
image verification, final current-heartbeat verification, record creation, and
active-state publication. Any failure before successful activation stops and
removes the worker, clears its heartbeat, and sets its database role to
`NOLOGIN` with no stored password.

A rollback target that predates this worker is explicitly fail-closed even
when the external flag remains `true`: the executor removes the worker, clears
the heartbeat, disables the worker database role and clears its password, the
old Event API retains its hard-disabled gate, and the record reports
`disabled-target-release-unsupported`. E-mail and push delivery stay inside the
provider sink until their approved providers are configured.

Provider settings may remain in the external environment when the flag returns
to `false`. In that state the executor overrides the enrichment database
password to an empty Compose interpolation value, so the grants job leaves
`crew_event_enrichment_worker` as `NOLOGIN`; the stored credential is passed
only while enablement is explicitly requested.

## Verification

Repository checks:

```sh
bash -n infra/staging/host-release.sh
bash -n infra/staging/github-deploy-command.sh
bunx biome check infra/staging-config.test.ts
bun test infra/staging-config.test.ts
```

After a deploy or rollback, verify externally:

```sh
curl --fail https://crew-haus.com/
curl --fail --location --max-redirs 0 \
  https://crew-haus.com/.well-known/apple-app-site-association
test "$(curl --silent --show-error --location --max-redirs 0 \
  --output /dev/null --write-out '%{http_code}' \
  https://crew-haus.com/.well-known/assetlinks.json)" = 404
curl --fail https://staging.crew-haus.com/internal/ready
curl --fail https://staging.crew-haus.com/docs/openapi.json
curl --fail https://staging.crew-haus.com:8444/minio/health/ready
```

Inspect the active record and Compose state on the host. Source, CI, or image
timestamps alone are not live-deployment proof.

After the one-time reset, additionally verify that the reset completion record
exists, `reset-in-progress` is absent, the active record has
`action=reset-deploy` and `dataReset=true`, all five fresh volumes exist, and
migration `0034_place_enrichment_admission.sql` is recorded with its expected
checksum
`2885071400f66d8e2ef684eacc6e5ad607cfebdc35bc05ecdd7a3fe46e0fcd1d`
in `event_schema_migrations`.

If the reset is interrupted while `main` is unchanged, use GitHub's
**Re-run failed jobs** on the same workflow run. If `main` has advanced, dispatch
the current workflow with the recorded reset target in `release_sha`,
`deploy=true`, `reuse_stored_manifest=true`, `reset_staging_data=false`, an
empty `expected_current_staging_sha`, and the consumed `github-actions-N` value
in `resume_reset_id`. Do not use a normal deploy or rollback while
`reset-in-progress` exists. If the completion record exists and the marker is
absent, verify the completed release instead of retrying the reset.
