# Golf scorecard Option 2 design QA

> **Historical record, not current acceptance.** The current asset manifest has
> 8/53 mismatches. The review below records the earlier source/capture pair;
> fresh normal, scrolled Large-Text and platform-parity captures must be produced
> from one frozen source and compared with the reference before this gate passes.

- Binding source: `../event-hub-option-2/reference-390x844.png`
- Normal implementations: `01-participant-queued-top-390x844.png` through
  `04-read-only-leaderboard-390x844.png`
- Accessibility implementations:
  `05-participant-accessibility-large-top-390x844.png` and
  `06-participant-accessibility-large-scrolled-390x844.png`
- Same-input reviews: `comparison-normal-1x.png` and
  `comparison-accessibility-large-1x.png`
- Viewport: iPhone 16e, exactly 390 x 844 points; native captures retained at
  1170 x 2532 pixels and normalized 1:1 without cropping
- States: participant queued top/editor, participant conflict, organizer
  read-only leaderboard and participant Accessibility Large before/after real
  native scroll interaction

## Findings

- P0: none.
- P1: none remaining. The first real scrolled capture exposed content passing
  behind the iOS status area. The final vertical scroll viewport starts below
  the top safe-area inset while preserving the original total top rhythm; all
  recaptured scroll states remain clean.
- P2: none remaining. The first Accessibility Large title split internally as
  `Scorek` / `arte`. The final fully scaled native text uses a soft hyphen for
  the semantic visual break `Score-` / `karte` and keeps the explicit
  accessibility label `Scorekarte`.

## Required fidelity surfaces

- Typography: DM Sans and shared Crew typography tokens drive the display
  title, overline, round name, chips, body, inputs and leaderboard hierarchy.
- Layout: 18-point gutters, rounded outlined cards, hard control shadows,
  compact delivery metadata and an action-first editor preserve the selected
  Option-2 rhythm.
- Color: lavender canvas, gold scoring/conflict surfaces, mint action/current
  ranking, purple supporting copy, white fields and near-black outlines come
  only from the shared theme.
- Assets: the checked-in Crew logo, board background, golf, offline, check and
  arrow raster assets remain crisp. No emoji, placeholder, inline SVG or new UI
  dependency is visible.
- Copy: German state language distinguishes local save, pending delivery,
  synchronized ranking, role-reduced read-only access and conflict requeue. It
  never exposes account, root, player or mutation identifiers.

## State-truth review

- Participant queued: the banner and hole badge say locally saved; neither
  claims server delivery. The inputs, preview, clear action and leaderboard
  remain visible together after a real scroll.
- Conflict: local and server strokes, putts and points remain complete in one
  card. The single action says that the local version will be sent again.
- Read-only: the role and explanation are visible, score inputs are absent, and
  the three-row leaderboard plus explicit sync action remain available.
- Busy and incomplete: synchronous operation serialization prevents same-tick
  double submission; retry/sync disable while active. An invalid editable
  projection never falls through to a misleading read-only state.

## Accessibility and interaction evidence

- Exact top/bottom safe areas are applied once. Automatic content inset
  adjustment is disabled and the one vertical `ScrollView` owns page reach.
- Shared buttons and hole controls are at least 48 points. Numeric inputs,
  selected hole, disabled/busy state and every icon-only action have accessible
  names and semantics.
- The heading preserves text scaling and pronunciation. Cards have no fixed
  text height; large type remains vertically reachable without horizontal
  clipping.
- `maestro-scroll.yaml` asserts the production view and performs the native
  normal-type swipe used for the editor capture.
- `maestro-scroll-accessibility.yaml` performs three native swipes from the
  large-type top state and reaches the selected-hole values in the persisted
  scrolled capture.

## Production and offline proof

- `GolfScorecardScreen` is a routed production surface. It composes role and
  root/round identity, then delegates to `GolfScorecardRuntime` and
  `GolfScorecardController`.
- The runtime reuses `GolfOfflineStore`, one `MobileSyncEngine`, secure UUIDs
  and the existing online signal. The screen never calls Event Service or
  mutates SQLite directly.
- Stable set/clear identities, durable overlay, restart replay, null/unplayed
  semantics, authoritative leaderboard aggregation and conflict replacement
  are covered below the view.
- Owner, organizer, viewer and ineligible-participant paths are read-only by
  controller projection, not only by hidden controls.
- Deterministic screenshot data exists only in the evidence entry. These files
  do not claim Android visual parity, deployed backend proof or a real
  service-backed disconnect/reconnect journey.

## Comparison history

1. The binding source and queued, conflict and read-only states were captured
   at the same 390 x 844 viewport and combined at 1:1.
2. Native swipe review found a top-safe-area collision. The scroll viewport was
   corrected, the Release bundle reinstalled and all affected states recaptured.
3. Accessibility review found one mid-word display-title split. Native soft
   hyphenation and an explicit unsplit accessibility label corrected it without
   capping text scaling.
4. The Accessibility Large top was recaptured; three real swipes produced the
   final editor continuation. Both comparison files were regenerated.
5. At capture time, both final composites were reopened with the source in the
   same input at original resolution and had no actionable P0/P1/P2 finding.
   Current manifest drift supersedes that result.

## Implementation checklist

- [x] Selected Option 2 source used as binding visual truth.
- [x] Production-routed screen uses shared tokens, primitives and real assets.
- [x] Participant queued/editor, complete conflict and true read-only states persist.
- [x] Exactly 18 holes, local Stableford and stable set/clear identities are enforced.
- [x] Existing Gateway/SQLite/Outbox/sync boundaries remain the only data path.
- [x] Exact 390 x 844 and real-scrolled Accessibility Large evidence persists.
- [ ] Regenerate source-current captures and repeat the same-input visual gate.

current result: open; historical pass superseded by manifest drift
