# Event Hub Option 2 — Android responsive QA

- Date: 2026-07-19
- Source visual truth: `reference-390x844.png`
- Implementation screenshot: `05-final-android-normal-unscrolled-412x915.png`
- Device: Android `emulator-5554`, 1080 × 2400 physical pixels, density 420, normalized to 412 × 915 logical pixels
- State: exact `turkeyGolfEventHubModel`, Plan tab
- Full-view comparison: `comparison-reference-vs-android-normal.png`
- Focused primary-card comparison: `comparison-reference-vs-android-primary-card.png`
- Large-text correction comparison: `comparison-android-large-before-after-next-time.png`
- Stacked-copy correction comparison:
  `comparison-android-large-stacked-before-after-copy.png`

The source and Android implementation intentionally retain their native
390 × 844 and 412 × 915 viewports in the combined inputs. They support
responsive and platform-parity review, not pixel-level same-viewport parity.

## Findings

- P0: none.
- P1: none.
- P2: none after the correction pass below.
- P3: At the wider Android viewport, `Welcome Dinner` fits on one line at
  normal type while the 390-point source wraps it over two. The hierarchy,
  card order, action and minimum touch target remain equivalent. Android also
  retains its real system bars and checked-in product rasters rather than the
  generated source's approximate icon artwork.

## Required fidelity surfaces

- Fonts and typography: bundled DM Sans is used. Normal type has no clipped or
  truncated copy. Real Android `font_scale=2.0` keeps `18:30`, both timeline
  times, `Welcome Dinner`, the route action and all four persistent navigation
  labels readable; the remaining copy reflows vertically and is reachable by
  scroll.
- Spacing and layout rhythm: header, participant stack, sync state, date strip,
  primary card, timeline, feed and fixed bottom navigation retain the Option-2
  order and rhythm at 412 × 915. The larger viewport exposes the full normal
  state without requiring vertical scroll.
- Colors and visual tokens: the lavender board, gold primary surface, mint
  action, lavender feed and ink borders use the shared Option-2 tokens.
- Image quality and asset fidelity: the Crew mark, seven participant portraits
  and checked-in raster icon set render sharply in the physical captures. No
  placeholder, emoji, improvised SVG or code-drawn substitute is used.
- Copy and content: event, participant, sync, itinerary and feed copy match the
  deterministic model. `FR 18` is intentional calendar truth; the generated
  source's `SA 18` is factually incorrect for September 2026.

## Comparison history

1. P2 — `qa-iteration-4-android-large-next-time-wrap.png`: the fixed 88-point
   time column split `18:30` into `18:3` and `0` at real Android 2.0 font scale.
   The time now stays on one line and cannot shrink. The first correction used
   an intrinsic-width horizontal column; its Android checkpoint is retained as
   `qa-iteration-5-android-intrinsic-column-large-unscrolled.png` and
   `qa-iteration-5-android-intrinsic-column-large-feed.png`.
2. Cross-platform Large Text review found that the intrinsic horizontal layout
   squeezed the adjacent iOS title and action. The shared implementation now
   switches the next card to a vertical composition at `fontScale >= 2`, with
   the time and icon on one row and a horizontal divider.
3. P2 — `qa-iteration-6-android-stacked-copy-collapse.png`: the first stacked
   Android build inherited `flex: 1` on the copy container, collapsed its
   height, and omitted `Welcome Dinner`. The large-text copy container now uses
   `flex: 0` and full width. The left/right correction is shown in
   `comparison-android-large-stacked-before-after-copy.png`; final proof is in
   `06-final-android-accessibility-2x-unscrolled-412x915.png` and
   `07-final-android-accessibility-2x-feed-412x915.png`.

`comparison-android-large-before-after-next-time.png` remains the focused
record of the original `18:30` wrap and the intrinsic-width correction that
preceded the final stacked layout.

## Native evidence and checks

- Normal top: `05-final-android-normal-unscrolled-1080x2400.png` and
  `05-final-android-normal-unscrolled-412x915.png`.
- A post-fix normal upward swipe produced an identical UI hierarchy and no
  content movement. The normal content measured 1957 physical pixels inside a
  2003-pixel vertical viewport, and the initial frame already exposes the
  complete feed card and fixed navigation. A separate "normal scroll" artifact
  would therefore be a mislabeled duplicate rather than meaningful evidence.
- Real `font_scale=2.0` top:
  `06-final-android-accessibility-2x-unscrolled-1080x2400.png` and
  `06-final-android-accessibility-2x-unscrolled-412x915.png`.
- Real `font_scale=2.0` meaningful feed scroll:
  `07-final-android-accessibility-2x-feed-1080x2400.png` and
  `07-final-android-accessibility-2x-feed-412x915.png`.
- Focused Jest: 2 suites, 24 tests passed. TypeScript, ESLint and Prettier
  passed for the changed view and regression.
- The visually accepted source hashes are
  `3714faacc35b4fe79c2befa44808fd6de8e13661b822bf74df59b8e28fb24ecb`
  for `EventHubView.tsx` and
  `e472100589f6bfd7a60675af39e8d5e2c6aadc27a883ba53c1308503cb6a1d3e`
  for its focused test.
- The isolated arm64 Android Release build embedded
  `evidence/event-hub-option-2-entry.js` and copied 22 raster assets. App-build
  plus Gradle-cache growth was 605,288 KiB, below the 1.5 GiB stop limit. It
  was locally signed with the repository debug key solely for emulator
  installation; this is not production signing.
- No uninstall or app-data clear was used. The original Debug APK was restored
  byte-for-byte, `font_scale` returned to 1.0, the app again showed
  `Bitte anmelden`, and the final state is recorded in
  `08-final-android-debug-restored-signed-out-412x915.png`.

final result: passed
