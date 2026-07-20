# Golf scorecard — Option 2 evidence

This folder is the persistent visual and implementation evidence for
`crew-paq.7.2.1`. The production-routed Golf scorecard applies the selected
Crew Board Option-2 language to participant entry, durable offline delivery,
conflict recovery and read-only ranking while preserving the existing Gateway,
SQLite and Outbox boundaries.

## Result

- Eligible participants receive exactly 18 ordered holes, local Stableford
  preview, set and explicit clear semantics, stable replay identity across
  restart, honest local-pending delivery and one sync action.
- A conflict keeps complete local and server values visible. Resending creates
  a fresh durable replacement before the old deadletter can be discarded.
- Owners, organizers, viewers and ineligible participants receive a true
  read-only leaderboard. Score inputs and write actions are absent.
- The routed screen uses `GolfScorecardRuntime`, the existing account/root
  `GolfOfflineStore` and one `MobileSyncEngine`. It has no direct Event Service
  or database-write path.
- The pure view uses shared Option-2 tokens and primitives, DM Sans, checked-in
  raster assets, 48-point controls and one safe-area-aware vertical scroll
  viewport.

## Persistent evidence

| Evidence                                                                                                 | Purpose                                                          |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Participant queued top, 390 x 844](./01-participant-queued-top-390x844.png)                             | Brand, role, round and honest local-pending state                |
| [Participant queued top, 1170 x 2532](./01-participant-queued-top-1170x2532.png)                         | Untouched physical 3x simulator capture                          |
| [Participant editor, 390 x 844](./02-participant-queued-editor-390x844.png)                              | Real-scroll 18-hole rail, values, local Stableford and actions   |
| [Participant editor, 1170 x 2532](./02-participant-queued-editor-1170x2532.png)                          | Untouched physical 3x scrolled capture                           |
| [Conflict resolution, 390 x 844](./03-conflict-resolution-390x844.png)                                   | Complete local/server comparison and explicit requeue            |
| [Conflict resolution, 1170 x 2532](./03-conflict-resolution-1170x2532.png)                               | Untouched physical 3x conflict capture                           |
| [Read-only leaderboard, 390 x 844](./04-read-only-leaderboard-390x844.png)                               | Organizer path without score-entry controls                      |
| [Read-only leaderboard, 1170 x 2532](./04-read-only-leaderboard-1170x2532.png)                           | Untouched physical 3x read-only capture                          |
| [Accessibility Large top, 390 x 844](./05-participant-accessibility-large-top-390x844.png)               | Near-200% text and semantic display-title wrapping               |
| [Accessibility Large top, 1170 x 2532](./05-participant-accessibility-large-top-1170x2532.png)           | Untouched physical 3x large-text capture                         |
| [Accessibility Large scrolled, 390 x 844](./06-participant-accessibility-large-scrolled-390x844.png)     | Three real swipes reach the rail and editable values             |
| [Accessibility Large scrolled, 1170 x 2532](./06-participant-accessibility-large-scrolled-1170x2532.png) | Untouched physical 3x scrolled large-text capture                |
| [Source and normal-state comparison](./comparison-normal-1x.png)                                         | Binding source plus queued editor, conflict and read-only at 1:1 |
| [Source and large-text comparison](./comparison-accessibility-large-1x.png)                              | Binding source plus large-text top and scrolled states at 1:1    |
| [Design QA](./design-qa.md)                                                                              | Same-input severity review and correction history                |

The fixture records live only in
`apps/mobile/evidence/golf-scorecard-option-2-entry.js`. Production navigation,
controllers and stores contain no evidence player, score or leaderboard data.

## Accessibility and interaction coverage

- The scroll viewport begins below the 47-point iOS top safe area. Scrolled
  content cannot pass underneath the status bar; bottom padding respects the
  34-point home-indicator inset.
- The display heading remains fully scaled. A native soft hyphen produces the
  semantic visual break `Score-` / `karte` at Accessibility Large while the
  explicit accessibility label remains `Scorekarte`.
- Hole selectors, inputs and actions expose stable labels, roles, selected,
  disabled and busy states. Status and role are always communicated in text,
  never by color alone.
- [Normal scroll](./maestro-scroll.yaml) and
  [Accessibility Large scroll](./maestro-scroll-accessibility.yaml) are the
  exact passing native interaction paths used for the persisted captures.

## Offline and authority boundary

The controller loads only an editable 18-hole scorecard whose ordered hole
numbers are exactly 1 through 18. Null strokes stay unplayed and do not enter
the authoritative leaderboard total. The local store projects saved values
immediately, writes one outbox intent per stable hole identity and preserves
that overlay across restart. Sync and conflict recovery remain inside the
shared sync engine; root denial uses the existing authoritative purge path.

The evidence app is deterministic visual proof, not a service-backed device
test. Android rendering, a real backend disconnect/reconnect journey and
deployed runtime proof remain under `crew-paq.7.4`.

## Validation

- Focused Golf view/controller/screen: 2 suites, 18 tests passed.
- Complete mobile gate: ESLint and TypeScript pass; 45 suites and 294 tests
  pass.
- Complete MobileData gate: Biome and TypeScript pass; 109 tests and 792
  expectations pass.
- Golf Event PostgreSQL contract: four tests and 32 expectations pass against a
  fresh migrated PostgreSQL database; Event Service Biome and TypeScript pass.
- Product inventory contract: four tests and 11 expectations pass. All changed
  evidence and handoff Markdown passes Prettier.
- Both final composites were reopened at original resolution with the binding
  source in the same input; no actionable P0, P1 or P2 remains.

## Reproduction notes

The existing Release simulator binary was copied into a scoped temporary
directory and rebundled with
`evidence/golf-scorecard-option-2-entry.js`. It was installed on the iPhone 16e
simulator and captured at 1170 x 2532 pixels. Every full-screen artifact was
normalized without cropping to exactly 390 x 844. The simulator was restored
to content size `large`, the temporary status-bar override was cleared and the
scoped app/JRE directories were deleted after capture.

`asset-manifest.sha256` locks the binding source, implementation inputs,
interaction paths and every final evidence output.
