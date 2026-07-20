# Option 2 native evidence freeze

Option 2 / Crew Board is the only binding direction. This file defines the
deterministic code-only inputs prepared for the next coordinated native capture.
It does not claim a build, simulator run, Android run or current screenshot.

## Pure-view entries and states

Each entry reads `CrewEvidenceState` once through React Native `Settings`. A
missing value uses the first safe state below; an unknown non-null value throws
instead of silently capturing the wrong state.

- `event-basics-option-2-entry.js`: `clean`, `concealed`, `conflict`,
  `offline-dirty`, `queued-offline`, `validation`.
- `event-setup-recovery-option-2-entry.js`: `cached-offline`, `cached-online`,
  `capability`, `concealed`, `place-no-results`, `place-results`,
  `place-selected`, `resolved`, `template-selected`, `template-unselected`.
- `community-feedback-option-2-entry.js`: `capture-busy`, `capture-failure`,
  `offline`, `ready`, `unavailable`, `updates`.
- `feedback-compose-option-2-entry.js`: `duplicates-cache`,
  `duplicates-error`, `duplicates-network`, `duplicates-searching`,
  `duplicates-skipped`, `receipt-attention`, `receipt-delivered`,
  `receipt-pending`, `screenshot-loading`, `screenshot-preview-checked`,
  `screenshot-preview-unchecked`, `screenshot-unavailable`, `text-only`,
  `unavailable`.

The Community fixture visibly contains both `QA QUELLE · ZÜRICH · 19 JULI`
and `ÖV-Plan für Zürich verbessern 🎉`. The Compose preview fixture uses a real
checked-in Event Hub screenshot only to exercise pure-view layout and consent.
It is not proof of native current-screen capture.

## Required capture order

1. Freeze shared mobile source and run lint, typecheck, Jest and manifest
   coverage.
2. Build isolated Release entries without using or replacing an occupied Metro
   process.
3. Capture iPhone 16e raw 1170 x 2532 images and no-crop 390 x 844 derivatives
   for normal plus Accessibility Large top/scrolled states.
4. Capture Android API 36 raw 1080 x 2400 and logical 412 x 915 evidence at
   normal and 2.0 font scale. Do not crop Android to the iOS viewport.
5. For the production screenshot flow, compare the visible Community marker,
   item order and crop with the Compose preview. Native capture is bounded to a
   2048-pixel edge and preview to 512 pixels, so raw hash equality is not an
   oracle. Compose itself must never appear inside its preview.
6. Prove success, safe text-only failure, offline pending delivery, restart,
   terminal `Ohne Screenshot senden` recovery and account-switch isolation on
   both platforms.
7. Restore iOS content size, Android font scale and status-bar overrides.
8. Regenerate each SHA-256 manifest only after the final images and comparison
   sheets exist, change `manifest-coverage.json` status from `stale` to
   `current`, then rerun both checksum and coverage gates.

Until step 8, zero-digest lines are intentional stale sentinels. A passing
coverage test means only that no rendering input or final evidence file is
missing from the manifest; it is not a current native-evidence claim.
