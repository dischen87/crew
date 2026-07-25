# Crew Next staging release and rollback

This runbook defines the Crew staging release contract for the new services.

The repository currently has no approved staging host, Swarm, registry target,
GitHub environment or deployment credentials. Consequently the committed tool
is deliberately **dry-run only**: it validates immutable inputs and emits the
complete ordered plan, but it cannot mutate Docker, GitHub or a remote host.
An authorized environment-specific executor may consume the plan only after the
infrastructure prerequisites below exist.

## Contract and safety boundary

`scripts/crew-next-release.ts` accepts only the literal environment `staging`
and the stack name `crew-next-staging`. Unknown fields, a production value,
tag-only images, mutable Git identifiers, private or non-HTTPS Gateway origins,
and inconsistent service captures fail before a plan is returned.

A release record binds:

- one immutable Git release ID;
- a separate database release ID, needed after a code-only rollback;
- digest-qualified API Gateway, User Service and Event Service images;
- the SHA-256 of `infra/postgres/grant-runtime.sql`;
- one canonical public HTTPS Gateway origin;
- the exact same origin as the mobile `CREW_GATEWAY_BASE_URL`;
- the eight current Swarm runtimes: Gateway, two APIs and five workers.

The User image is shared by `user-api`, `magic-worker` and `push-worker`. The
Event image is shared by `event-api`, `attachment-worker`,
`notification-worker` and `recap-retention-worker`. A capture is rejected if
any member of an image group differs.

Rollback changes code images only. It never reverses a schema migration, grant
or live data. After the first successful release, an immutable CI evidence
record must prove that the previous code is compatible with the target database
release before a forward rollout or manual rollback can be planned.

The initial Greenfield deployment has no previous release. The current planner
does not implement that bootstrap path; the staging executor must add and prove
it before the first deployment.

## Required staging infrastructure

Provisioning is intentionally outside this repository slice because no target
has been approved. Before execution, the staging owner must provide and record:

- a Swarm manager and attachable `crew-next-staging_internal` overlay network;
- an authenticated OCI registry containing all three release images by digest;
- the eight pre-provisioned services named by the contract;
- private PostgreSQL, Redis, object-store, Typesense and provider dependencies;
- existing Swarm secrets named
  `crew-next-staging-user-owner-database-url`,
  `crew-next-staging-event-owner-database-url` and
  `crew-next-staging-postgres-admin-url`;
- TLS and routing for the approved staging Gateway origin;
- an append-only, access-controlled location for release records and evidence;
- an authorized executor that implements each emitted step and stops on the
  first mismatch or failed health check.

No secret value belongs in Git, a release record, a Docker label, command
output, or CI artifact.

## Release record

The canonical JSON shape is:

```json
{
  "schemaVersion": 1,
  "environment": "staging",
  "stack": "crew-next-staging",
  "releaseId": "<40-or-64-character-lowercase-git-revision>",
  "databaseReleaseId": "<same-revision-for-a-forward-deploy>",
  "recordedAt": "2026-07-20T10:00:00.000Z",
  "publicGatewayOrigin": "https://<approved-staging-gateway-host>",
  "mobileGatewayBaseUrl": "https://<approved-staging-gateway-host>",
  "runtimeGrantSha256": "<sha256-of-infra/postgres/grant-runtime.sql>",
  "images": {
    "api-gateway": "<registry>/<repository>@sha256:<64-lowercase-hex>",
    "user-service": "<registry>/<repository>@sha256:<64-lowercase-hex>",
    "event-service": "<registry>/<repository>@sha256:<64-lowercase-hex>"
  }
}
```

For a normal forward deploy, `releaseId` and `databaseReleaseId` must match.
After rollback, the code `releaseId` is the previous release while
`databaseReleaseId` and `runtimeGrantSha256` remain at the current forward
state.

## Capture the previous live release

This section applies after the initial Greenfield deployment.

Capture all services before any migration, grant or image update:

```sh
docker service inspect \
  crew-next-staging_user-api \
  crew-next-staging_magic-worker \
  crew-next-staging_push-worker \
  crew-next-staging_event-api \
  crew-next-staging_attachment-worker \
  crew-next-staging_notification-worker \
  crew-next-staging_recap-retention-worker \
  crew-next-staging_api-gateway \
  > previous-services.json

bun scripts/crew-next-release.ts capture \
  --environment staging \
  --inspect previous-services.json \
  --recorded-at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  > previous-release.json
```

The capture requires identical `crew.environment`, `crew.release-id`,
`crew.database-release-id`, `crew.runtime-grant-sha256`,
`crew.public-gateway-origin` and `crew.mobile-gateway-base-url` labels on all
eight services. Missing, duplicate or unexpected services fail closed. Store
the raw inspect output and canonical record together before continuing.

## Rollback compatibility proof

The proof is a separate immutable record so an old release record never needs
to be edited after publication:

```json
{
  "schemaVersion": 1,
  "environment": "staging",
  "fromReleaseId": "<target-release-id>",
  "toReleaseId": "<captured-previous-release-id>",
  "databaseReleaseId": "<target-database-release-id>",
  "verifiedAt": "2026-07-20T09:59:00.000Z",
  "evidence": "ci:crew-next:rollback-compatibility:<target-release-id>",
  "evidenceSha256": "<sha256-of-the-evidence-bundle>"
}
```

The evidence bundle must show the previous Gateway, User/Event APIs and worker
images starting against databases migrated and granted by the target release,
then passing the same private readiness and public Gateway contract probes. A
human assertion is not accepted as `ci:` evidence.

## Generate the forward plan

The source checkout must be clean, `HEAD` must equal `origin/main`, the target
record must name that exact revision, and all images must already be available
by digest. Generate the plan without side effects:

```sh
bun scripts/crew-next-release.ts deploy \
  --environment staging \
  --target target-release.json \
  --previous previous-release.json \
  --proof rollback-proof.json \
  > deploy-plan.json
```

The plan is ordered and must be executed sequentially:

1. Verify clean source, exact `origin/main`, previous live capture, image
   digests and the repository grant digest.
2. Run User and Event migrations as isolated `replicated-job` tasks using the
   owner URL secrets. Both must exit successfully.
3. Apply the exact runtime grants with the pinned PostgreSQL image and admin URL
   secret. This must exit successfully.
4. Update User API/workers, Event API/workers, and finally the Gateway. Use
   `start-first`, parallelism one, automatic image rollback on update failure,
   and pause if rollback itself fails.
5. Wait up to 180 seconds for every desired task to run; reject paused or failed
   updates.
6. From the private overlay, require HTTP 200 plus `status: ready` from User,
   Event and Gateway `/internal/ready` endpoints.
7. Through the public HTTPS origin, require the Gateway readiness contract and
   the pinned OpenAPI 3.1 document.
8. Recapture all eight services and store the resulting release record.

The executor must not skip a failed step, use a mutable tag, substitute a
different grant file, or turn a failed probe into a warning.

## Generate and exercise the rollback plan

Use the recaptured current release, the pre-deploy release and the same
compatibility proof:

```sh
bun scripts/crew-next-release.ts rollback \
  --environment staging \
  --current current-release.json \
  --previous previous-release.json \
  --proof rollback-proof.json \
  > rollback-plan.json
```

The rollback plan is gateway-first to stop newer edge behavior before older
service images return. It then restores Event API/workers and User API/workers,
waits for convergence, repeats all private/public probes, and requires a new
capture. Its `retain-database-state` step explicitly sets migration, grant and
data-restore actions to `none`.

Generating this plan and passing the unit suite exercises the local rollback
contract. It is not evidence that a real staging rollback succeeded.

## Mobile environment selection

The release record requires `mobileGatewayBaseUrl` to equal the approved public
Gateway origin byte-for-byte. Use that value as `CREW_GATEWAY_BASE_URL` for the
staging Release archive as documented in `apps/mobile/README.md`. A development,
localhost, private, placeholder or production origin is rejected by this
staging contract. Built mobile binaries still require their own signed-artifact
inspection and authenticated Gateway smoke before distribution.

## Local verification

These checks do not require Docker and do not contact staging:

```sh
bunx biome check scripts/crew-next-release.ts scripts/crew-next-release.test.ts
bun test scripts/crew-next-release.test.ts
bunx tsc --noEmit \
  --allowImportingTsExtensions \
  --moduleResolution bundler \
  --module preserve \
  --target esnext \
  --types bun \
  scripts/crew-next-release.ts \
  scripts/crew-next-release.test.ts
```

Keep `crew-paq.9.5` open until an approved staging target runs a clean forward
deploy, public/private smoke, live capture and actual rollback successfully.
