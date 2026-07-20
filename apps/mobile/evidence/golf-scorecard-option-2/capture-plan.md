# Golf scorecard Option 2 capture plan

Binding source: `../event-hub-option-2/reference-390x844.png`.

Target: booted iPhone 16e `F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`,
1170 x 2532 physical pixels / exactly 390 x 844 logical points. Capture only
after the Event Creation evidence run explicitly releases this simulator and
its scoped build directory.

## Capture matrix

| File stem | Fixture state | Content size | Required visible proof |
| --- | --- | --- | --- |
| `01-participant-queued-top` | `participant-queued` | `large` | Brand, title, role, honest local-pending status and offline message |
| `02-participant-queued-editor` | `participant-queued` | `large` | 18-hole progress and rail, selected hole 1, numeric inputs, local Stableford result, clear/save actions |
| `03-conflict-resolution` | `conflict` | `large` | Conflict alert, complete local and server versions, explicit requeue action |
| `04-read-only-leaderboard` | `read-only` | `large` | Organizer read-only explanation, real ranking rows, no score inputs or write action |
| `05-participant-accessibility-large-top` | `participant-queued` | `accessibility-large` | Near-200% type growth, complete top hierarchy, no horizontal clipping |
| `06-participant-accessibility-large-scrolled` | `participant-queued` | `accessibility-large` | Real vertical-scroll continuation through the editor at large type |

Every stem receives both an untouched `-1170x2532.png` simulator screenshot
and a no-crop `-390x844.png` normalization. The scroll captures must come from
real interaction with the installed app, not a translated or stitched view.

## Isolated release bundle

Reuse the existing Release simulator binary; do not start another Xcode build.
Copy it into one scoped `mktemp` directory and replace only its JS bundle and
bundled assets with:

```sh
bunx react-native bundle \
  --entry-file evidence/golf-scorecard-option-2-entry.js \
  --platform ios \
  --dev false \
  --minify true \
  --bundle-output "$GOLF_EVIDENCE_APP/main.jsbundle" \
  --assets-dest "$GOLF_EVIDENCE_APP"
```

The three fixture states are selected through the app-scoped
`CrewEvidenceState` setting. Production navigation, controller, SQLite and
Gateway code contain no evidence records.

## Final comparisons and QA

- Normal comparison: source + queued editor + conflict + read-only, every panel
  at 1:1 and 390 x 844.
- Accessibility comparison: source + large-type top + real scrolled state,
  every panel at 1:1 and 390 x 844.
- Inspect both combined files in one input with the binding source. Check type,
  safe areas, spacing, outlines, shadows, assets, wrapping, touch targets,
  state truth and scroll reach.
- Fix and recapture any actionable P0, P1 or P2. `design-qa.md` may say
  `final result: passed` only after that review is complete.
- Restore the simulator to `large`, clear the temporary status-bar override,
  delete the scoped app/build copy and record all inputs/outputs in
  `asset-manifest.sha256`.
