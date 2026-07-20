# Production Team routes evidence

This evidence renders the selected Option 2 design through the production Team
composition rather than through the design-fixture entry point.

## What is exercised

- The evidence entry opens the real account-scoped SQLCipher database, runs all
  mobile-data migrations, and writes the normal bootstrap read models.
- `MemberDirectoryStore.refresh` writes only `userId` and nullable
  `displayName` into the account + root scoped SQLite directory.
- `TeamProductionRuntime` loads the assignment and decision models from those
  persisted read models and resolves every visible person name from that local
  directory. The deliberately null fourth name renders as the neutral
  `Teilnehmende Person 3` label.
- The production views, accessibility tree, route adapters, role guards, and
  outbox mutation methods are the same modules used by `RootNavigator`.

The deterministic records in `team-production-routes-entry.js` exist only to
make an isolated, repeatable simulator capture. No fixture data or evidence
client is imported by a production controller or screen. The evidence client's
single generated-operation-shaped response is accepted only by
`MemberDirectoryStore.refresh`; production networking remains Gateway-only.

## Captures

- `01-team-setup-production-1170x2532.png`: native iPhone 16e simulator output.
- `01-team-setup-production-390x844.png`: exact 1:1 point normalization.
- `02-decision-production-1170x2532.png`: native iPhone 16e simulator output.
- `02-decision-production-390x844.png`: exact 1:1 point normalization.
- `03-team-draft-production-1170x2532.png`: native manager move before
  persistence or publication.
- `03-team-draft-production-390x844.png`: exact 1:1 point normalization with
  the honest `Änderungen offen · noch nicht veröffentlicht` state.
- `comparison-reference-vs-production-team.png`: one same-input 2 x 2 contact
  sheet containing the binding Option-2 Event Hub source followed by Team
  setup, Decision, and the unpublished assignment draft at the same 390 x 844
  viewport.

All three states use a real account/root database. The setup and draft captures
prove that a pre-publish move stays explicitly in-memory; the Decision capture
uses the same production runtime composition without replacing the data layer.

## Reproduction

1. Bundle `team-production-routes-entry.js` into the normal `CrewNext` iOS
   target.
2. Install and launch the bundle on the iPhone 16e simulator.
3. Capture the Team setup screen, then run `maestro-assignment-draft.yaml` to
   move a member and assert the honest unpublished state.
4. Run `maestro-decision.yaml` with the local OpenJDK 17 `JAVA_HOME` to activate
   the accessible back control and assert the production Decision heading.
5. Capture the Draft and Decision screens and normalize each 3x PNG to 390 x 844 with
   `sips`.

## QA boundary

- iOS: runtime-rendered and accessibility-driven at the exact 390 x 844 point
  viewport.
- Android: source, route, role-guard, and Jest coverage only for these Team
  routes. The available Android toolchain was not used for this capture set, so
  Android Team-route rendering is not claimed here.
