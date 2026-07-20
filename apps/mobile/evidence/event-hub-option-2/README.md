# Event Hub — Option 2 evidence

The binding visual source is `reference-390x844.png`. The deterministic native
entry is `apps/mobile/evidence/event-hub-option-2-entry.js`; it renders
`turkeyGolfEventHubModel` through the production `EventHubView`.

## Current native evidence

### iOS

- `01-final-unscrolled-*`: normal Dynamic Type at the initial scroll position.
- `02-final-feed-*`: normal Dynamic Type with the feed summary fully visible.
- `03-final-accessibility-large-unscrolled-*`: real iOS Accessibility Large at
  the initial scroll position.
- `04-final-accessibility-large-feed-*`: real iOS Accessibility Large with the
  primary action, timeline, feed and persistent navigation visibly readable.
- `09-final-ios-accessibility-large-next-card-top-*` and
  `10-final-ios-accessibility-large-next-card-action-*`: paired scroll states
  proving that the vertically composed large-text card keeps `18:30`,
  `Welcome Dinner`, `Hotellobby` and `Route öffnen` readable and reachable.
- `11-final-ios-debug-restored-signed-out-*`: the original Debug app restored
  at medium Dynamic Type and the signed-out private boundary.
- `comparison-reference-vs-implementation.png`: the binding reference and the
  current normal implementation in one 800 × 844 comparison input.
- `comparison-ios-large-before-after-next-card.png`: same-state Accessibility
  Large evidence showing the intrinsic-column title fragmentation on the left
  and the final stacked card on the right.
- `qa-iteration-*`: durable before-fix evidence for the title, navigation-label
  timeline-time, intrinsic-column and stacked-copy correction passes recorded
  in the project-root `design-qa.md`.
- `maestro-scroll.yaml`: the reproducible scroll/assertion used at both iOS
  content sizes.

All iOS captures come from the exact iPhone 16e simulator at 1170 × 2532 raw
pixels with no-crop 390 × 844 derivatives. The Release app bundled the pure-view
entry and 22 checked-in raster assets without using or replacing Metro.

### Android

- `05-final-android-normal-unscrolled-*`: normal type at the natural top.
- `06-final-android-accessibility-2x-unscrolled-*` and
  `07-final-android-accessibility-2x-feed-*`: real Android `font_scale=2.0`
  top and meaningful feed scroll with the final stacked next card.
- `08-final-android-debug-restored-signed-out-412x915.png`: original Debug APK,
  font scale 1.0 and signed-out boundary restored.
- `comparison-reference-vs-android-*` and `comparison-android-large-*`: the
  normal source comparisons and both large-text correction checkpoints.
- `android-responsive-qa.md`: device facts, findings, source hashes, build
  boundary and restoration proof.

Android evidence comes from `emulator-5554` at 1080 × 2400 physical pixels,
density 420, with 412 × 915 logical derivatives. Android keeps its real native
viewport rather than being cropped to the iOS source.

## Gate status

The iOS normal and Accessibility Large surfaces and Android normal and real
2.0-font surfaces passed visual inspection on the same frozen
`EventHubView.tsx` source. Both platforms were restored to their original Debug
app, normal text setting and signed-out boundary without uninstalling or
clearing app data. `asset-manifest.sha256` binds every rendering input,
comparison, QA checkpoint and final artifact with real digests; the
`event-hub-option-2` coverage-policy status is `current`.

See `apps/mobile/evidence/option-2-native-qa.md` for the coordinated platform
capture order.
