# Event Hub Option 2 — Design QA

- Date: 2026-07-19
- Source visual truth: `apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Implementation screenshot: `apps/mobile/evidence/event-hub-option-2/01-final-unscrolled-390x844.png`
- Viewport: iPhone 16e, 390 × 844 logical points (1170 × 2532 physical pixels)
- State: `turkeyGolfEventHubModel`, Plan tab, normal Dynamic Type
- Full-view comparison: `apps/mobile/evidence/event-hub-option-2/comparison-reference-vs-implementation.png`
- Focused comparison: not needed; both 390 × 844 surfaces remain readable at 1:1 inside the 800 × 844 combined image, including the title, date strip, primary card, timeline and navigation.

## Findings

- P0: none.
- P1: none.
- P2: none after the six correction passes below.
- P3: The implementation retains real iOS status/safe-area chrome, factually correct September 2026 weekdays and the checked-in product rasters. Those deliberate differences shift the vertical rhythm slightly and replace the generated reference's approximate icons. The feed card sits below the initial fold but is fully visible in the paired scrolled capture.

## Required fidelity surfaces

- Fonts and typography: DM Sans is bundled; normal type preserves the reference's two-line `Welcome Dinner` hierarchy. At iOS Accessibility Large and Android `font_scale=2.0`, the next card stacks vertically so `18:30`, `Welcome Dinner`, `Hotellobby` and the route action retain natural readable widths. Persistent tab labels and timeline times remain free of mid-word fragmentation.
- Spacing and layout rhythm: the header, date strip, primary card, two timeline rows and fixed navigation retain the Option-2 hierarchy. Native top/bottom safe areas are intentionally preserved.
- Colors and visual tokens: the lavender board, gold primary surface, mint action and ink borders use the existing Option-2 tokens and visibly match the reference language.
- Image quality and asset fidelity: the checked-in Crew mark, seven participant portraits and raster icon set render sharply at 3×. No placeholder, emoji, CSS drawing or improvised SVG replaces a visible asset.
- Copy and content: the event, participant, sync, itinerary and feed copy match the deterministic model. `FR 18` is intentional calendar truth; the reference's `SA 18` is incorrect for September 2026.

## Comparison history

1. P2 — `qa-iteration-1-single-line-title.png`: the implementation compressed `Welcome Dinner` to one line. Removing the local 30/32 override restored the existing 32/36 title token and the reference's two-line hierarchy. Post-fix evidence: `comparison-reference-vs-implementation.png`.
2. P1 — `qa-iteration-2-large-nav-wrapping.png`: real Accessibility Large split `Crew` and `Mehr` into mid-word fragments. The shared bottom-navigation label now remains one line with a 2× navigation-only scaling ceiling while VoiceOver retains the full tab label. Post-fix evidence: `03-final-accessibility-large-unscrolled-390x844.png`.
3. P1 — `qa-iteration-3-large-timeline-wrap.png`: fixed-width time columns fragmented `09:00`. Times now keep their intrinsic width, never shrink and remain one line; itinerary copy uses the remaining width. Post-fix evidence: `04-final-accessibility-large-feed-390x844.png`.
4. P2 — `qa-iteration-4-android-large-next-time-wrap.png`: Android 2.0 split the next-card `18:30` inside the fixed 88-point column. The time and its parent now use an intrinsic width with an 88-point minimum. This corrected the number but exposed the next responsive checkpoint.
5. P1 — `qa-iteration-5-ios-intrinsic-column-large-next-card.png` and the two `qa-iteration-5-android-intrinsic-column-*` images: the widened horizontal time column squeezed adjacent title and action content. At `fontScale >= 2`, the shared card now composes vertically with a time/icon row and horizontal divider. The same-state iOS correction is visible in `comparison-ios-large-before-after-next-card.png`.
6. P1 — `qa-iteration-6-ios-large-next-copy-collapse.png` and `qa-iteration-6-android-stacked-copy-collapse.png`: the first vertical build inherited `flex: 1` on the copy block, collapsed its natural height and omitted or overlaid content. Large text now uses a zero-flex, full-width copy block. Final proof is in iOS captures `09`/`10`, Android captures `06`/`07`, and `comparison-android-large-stacked-before-after-copy.png`.

## Native evidence and checks

- Normal top: `01-final-unscrolled-1170x2532.png` and `01-final-unscrolled-390x844.png`.
- Normal scrolled feed: `02-final-feed-1170x2532.png` and `02-final-feed-390x844.png`.
- Accessibility Large top: `03-final-accessibility-large-unscrolled-1170x2532.png` and `03-final-accessibility-large-unscrolled-390x844.png`.
- Accessibility Large scrolled feed: `04-final-accessibility-large-feed-1170x2532.png` and `04-final-accessibility-large-feed-390x844.png`.
- Accessibility Large next-card top/action: `09-final-ios-accessibility-large-next-card-top-*` and `10-final-ios-accessibility-large-next-card-action-*`.
- Android normal: `05-final-android-normal-unscrolled-*`.
- Android real 2.0 top/feed: `06-final-android-accessibility-2x-unscrolled-*` and `07-final-android-accessibility-2x-feed-*`.
- `maestro-scroll.yaml` passed on the exact iPhone 16e for both Dynamic Type sizes and makes the full feed summary visible before capture.
- Android focused Jest: 2 suites, 24 tests passed. Final mobile Jest passed 60 suites and 479 tests; Prettier, TypeScript, ESLint, checksum and manifest-coverage gates also passed.
- The isolated iOS Release build used `evidence/event-hub-option-2-entry.js`, copied 22 raster assets and stayed below the 1.5 GiB stop limit. Android's isolated Release build and cache growth was 605,288 KiB, also below the limit.
- iOS restored the exact Debug executable (`36ccae09…746e`) and Debug dylib (`9464da6e…fa17`), medium Dynamic Type and a signed-out screenshot byte-identical to the pre-gate hash (`9e671a6d…1b53`). Android restored its byte-identical Debug APK, font scale 1.0 and signed-out surface. Ports 8081 and 8082 retained their original listeners.

final result: passed
