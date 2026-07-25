# Crew Next staging preflight

`.github/workflows/crew-next-staging-preflight.yml` is a manual, read-only gate
in front of the dry-run release contract. It never selects the legacy workflow,
uses deployment secrets, contacts an executor or mutates staging.

Before dispatch, configure:

- the protected GitHub environment `crew-next-staging` with at least one
  required reviewer and protected-branches-only deployment policy;
- repository variable `CREW_NEXT_STAGING_REGISTRY` with the exact OCI namespace;
- repository variable `CREW_NEXT_STAGING_EXECUTOR` with
  `self-hosted:crew-next-staging`;
- canonical target, previous-release and rollback-proof JSON from
  `docs/operations/crew-next-staging-and-rollback.md`.

The staging proof must identify one immutable GitHub Actions artifact as
`ci:github-actions:<run-id>:<artifact-id>`. The artifact must be named
`crew-next-rollback-compatibility-<target-release-id>`, retain GitHub's
`sha256:` digest in `evidenceSha256`, and come from a successful manual
`main` run of `.github/workflows/crew-next-rollback-compatibility.yml` at the
exact target release.

That workflow currently publishes only a
`validation-only/source-contract` artifact. It binds the exact `main` revision,
successful Crew Next CI run, canonical release pair, dry-run rollback plan,
manifest SHA-256 and GitHub artifact digest. It does not start the previous
images against the target database and therefore is not runtime rollback
proof. The preflight downloads the exact artifact, checks its strict three-file
layout, manifest and plan digests and release IDs, then explicitly rejects this
validation-only scope. Do not pass its receipt as `rollback_proof`.

The preflight remains intentionally fail-closed until the approved staging
executor extends the compatibility workflow to exercise the previous Gateway,
API and worker images against the migrated target database and records
successful private/public probes plus the observed rollback release.

The hosted preflight reads the environment through GitHub's read-only API
before referencing it. A missing environment therefore fails instead of being
implicitly created. It also reads the referenced artifact and workflow-run
metadata from GitHub and downloads the artifact rather than trusting
dispatcher-supplied evidence fields. It then requires `refs/heads/main`,
identical GitHub, checkout and `origin/main` revisions, target images under the
configured registry by digest, the repository grant digest and runtime
rollback evidence. The currently produced source-contract artifact is
deliberately rejected at the last evidence boundary.

Once real runtime evidence exists, success may emit only
`execution: validation-only` around the existing `dry-run-only` plan.
Provisioning the registry and executor, verifying image availability, approving
environment-scoped credentials, executing the plan and capturing real
forward/rollback evidence remain external prerequisites.
