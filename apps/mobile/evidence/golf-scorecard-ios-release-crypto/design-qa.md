# Design 2 visual QA

The accepted screenshots were inspected at the native 390 x 844 viewport on
an iPhone 16e Simulator in light appearance and medium content size.

## Result

The Golf Scorecard preserves the intended Design 2 language throughout the
offline and synchronized states: lavender board texture, yellow scoring cards,
mint status/readback accents, hard black outlines and offset shadows, DM Sans,
large numerals, and compact uppercase labels. The visual state changes are
clear without changing the underlying layout:

- Local queue state uses both plain-language copy and a lavender
  `LOKAL GESPEICHERT` pill.
- Hole 1 keeps 5 strokes, 2 putts, and 2 points visibly anchored through the
  cold relaunch and committed-503 states.
- Convergence replaces the pending message with the synchronized state without
  causing card movement or content ambiguity.
- Owner readback distinguishes the owner/live context while preserving the same
  score hierarchy and confirms 2 points across 1 of 18 holes.

The main touch controls meet the 48-point target. No text is clipped, no control
overlaps another, safe-area spacing remains intact, the score card hierarchy is
scannable one-handed, and the horizontal hole selector intentionally signals
additional holes beyond the viewport. The restored Debug screenshot is
pixel-hash identical to the captured pre-run baseline.
