# Legacy deploy quarantine

The cloned `Deploy Crew App` workflow belongs to the pre-Crew-Next API and web
stack. It must not be treated as the Crew Next delivery path.

## Guardrails

- The workflow is manual-only and requires the exact confirmation
  `DEPLOY_LEGACY`.
- The operator chooses `staging` or `production`. A production request still
  passes through the staging job first.
- GitHub environments `legacy-staging` and `legacy-production` are the approval
  boundaries. Configure required reviewers for both environments, with a
  stricter reviewer set for production, before running the workflow.
- Only one legacy deployment may run at a time.
- Crew Next validation runs in `crew-next-ci.yml`; this workflow neither proves
  nor deploys Crew Next.

## Rollback targets

The legacy remote targets remain `/opt/crew-staging` with Compose project
`crew-staging`, and `/opt/crew` with Compose project `crew`. Before any manual
run, record the currently deployed Git revision and image IDs for the selected
target. Rollback means restoring those recorded revisions/images with the same
target-specific Compose file and environment file.

This repository does not yet contain an exercised rollback automation. Do not
claim a successful deployment or rollback without the corresponding GitHub run,
remote health evidence and recorded before/after revisions. Crew Next staged
deployment and rollback remain tracked separately in `crew-paq.9.5`.

## Crew Next pre-first-deploy baseline

The current Crew Next service and mobile packages are a fresh baseline: they are
not tracked in repository history or any `origin/main` tree, and the legacy
workflow above cannot deploy them. Therefore no older repository-derived Event,
Gateway or Mobile contract instance can be running. Migrations `0017` and `0023`
belong to the same first-deploy migration chain, not a rolling mixed-version
release.

Migration `0023_feedback_community.sql` still defensively normalizes completed
legacy-shaped generic feedback success receipts. Only the stored idempotency
response projection is bounded; feedback, comments and status history in domain
tables remain untouched. Before the first Crew Next deployment, release evidence
must record the Git revision, contract digests and migration ledger. After that
deployment, this fresh-baseline exception no longer applies: future contract and
migration changes require explicit rolling compatibility.
