# Event recap — Option 2 evidence

> **Stale evidence:** These native images predate the current `RecapView` and
> mobile-data source. They remain historical artifacts only. The checksum and
> coverage gates must stay red until normal, Accessibility Large and Android
> parity captures are regenerated after the final shared source freeze.

This folder is the persistent visual and implementation evidence for
`crew-paq.3.6`. The production-routed Recap screen applies the selected Crew
Board Option-2 language to organizer review, publication, removal and explicit
title-only sharing while preserving the generated-Gateway-client and private
SQLite boundaries.

## Result

- Organizers and owners can generate a draft, review its source-derived
  moments, publish the exact reviewed version, remove it, create a seven-day
  title-only link, share that link with the native share sheet and revoke it.
- Participants and viewers render only published recaps. An authorized,
  account-and-root-scoped SQLite snapshot remains readable offline; draft,
  removed, denied, stale or newly private content is purged after an
  authoritative check and stays absent across restart.
- Generation, publication, removal, share-link creation and revocation require
  a real online Gateway response. Offline controls offer only `Online prüfen`;
  no mutation is queued or reported as successful.
- Every remote operation uses the generated mobile Gateway client. The mobile
  app does not call a recap or event service directly, and the evidence records
  never enter the production controller.
- The share token exists only in the successful controller response and current
  React state long enough to construct the native share payload. It is not
  stored in SQLite, navigation state, diagnostics or the mutation outbox.
- The implementation uses shared Option-2 tokens and primitives plus the
  checked-in Crew logo, board background and raster icons. There are no emoji,
  placeholder assets, new UI dependencies or fixed-height text containers.

## Persistent evidence

| Evidence                                                                                                         | Purpose                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Organizer published, 390 x 844](./01-organizer-published-390x844.png)                                           | Exact manager review/share/remove state                             |
| [Organizer published, 1170 x 2532](./01-organizer-published-1170x2532.png)                                       | Physical 3x simulator capture                                       |
| [Organizer draft, 390 x 844](./02-organizer-draft-390x844.png)                                                   | Review warning plus online publish/remove controls                  |
| [Organizer draft, 1170 x 2532](./02-organizer-draft-1170x2532.png)                                               | Physical 3x simulator capture                                       |
| [Participant offline, 390 x 844](./03-participant-offline-390x844.png)                                           | Authorized published cache and honest online retry                  |
| [Participant offline, 1170 x 2532](./03-participant-offline-1170x2532.png)                                       | Physical 3x simulator capture                                       |
| [Accessibility Large, 390 x 844](./04-participant-offline-accessibility-large-390x844.png)                       | Near-200% iOS type, complete CTA and no horizontal clipping         |
| [Accessibility Large, 1170 x 2532](./04-participant-offline-accessibility-large-1170x2532.png)                   | Unscaled accessibility capture                                      |
| [Accessibility Large scrolled, 390 x 844](./05-participant-offline-accessibility-large-scrolled-390x844.png)     | Real scroll continuation through both moment cards                  |
| [Accessibility Large scrolled, 1170 x 2532](./05-participant-offline-accessibility-large-scrolled-1170x2532.png) | Unscaled scrolled accessibility capture                             |
| [Source and normal-state comparison](./comparison-reference-vs-recap.png)                                        | Binding source plus three complete 390 x 844 implementations at 1:1 |
| [Source and accessibility comparison](./comparison-reference-vs-recap-accessibility.png)                         | Binding source plus top and scrolled large-type states at 1:1       |
| [Design QA](./design-qa.md)                                                                                      | Severity review, fidelity checks and comparison history             |

The realistic Turkey Golf records live only in
`apps/mobile/evidence/recap-option-2-entry.js`. Production `RecapScreen` loads
the signed-in account's private database, session lifecycle and generated
Gateway client, then delegates authorization and persistence to
`EventRecapController`.

## Accessibility and state coverage

- The view is one safe-area-aware vertical `ScrollView`; headings, status,
  controls and recap content grow naturally with no `numberOfLines` or
  `maxFontSizeMultiplier` cap.
- Every control is built from shared 48-point-or-larger primitives and exposes
  a visible label, role, disabled/busy state and an action-specific hint where
  needed.
- Phase and role remain visible as text chips; offline, current and failure
  states include text in addition to color and icons.
- The `accessibility-large` captures preserve fully scaled copy, an entirely
  visible `Online prüfen` CTA and reachable moment content without horizontal
  clipping. The scrolled capture is direct simulator interaction evidence.
- Loading, empty, draft, published, concealed, manager, participant, viewer,
  offline manager, active-share and safe failure-copy states are covered by the
  pure-view and controller tests.

## Offline, authorization and sharing boundary

`EventRecapController` keys cache and command-attempt rows by signed-in account
and root event. It checks an active local membership before reads and writes,
binds every Gateway request to the exact session subject, validates returned
root/version/lifecycle state and uses a stable idempotency key for the same
command fingerprint across restart. An account switch rejects the in-flight
result rather than writing it into the new scope.

Only a reviewed locally cached published version can create a title-only share
link. The native app constructs the canonical Crew URL after successful
creation; this evidence does not claim that a web consumer was deployed or
live-tested in this no-deploy slice.

## Validation

- Mobile: 31 suites and 164 tests passed, plus ESLint and TypeScript.
- MobileData: 82 tests and 675 expectations passed, plus Biome and TypeScript.
- Generated mobile client: generation check, Biome, TypeScript and 55 tests
  passed.
- Product contract inventory: 4 tests passed.
- The isolated Release evidence app built successfully for the iPhone 16e
  simulator.

## Reproduction notes

The Release app was bundled with
`ENTRY_FILE=evidence/recap-option-2-entry.js`, installed on the iPhone 16e
simulator and captured at 1170 x 2532 pixels. Every full-screen artifact was
normalized to exactly 390 x 844 without cropping. The two comparison files keep
every panel at 1:1 with 16-pixel separators. The simulator content size was
returned to `large` and the temporary status-bar override was cleared after
capture. `asset-manifest.sha256` records the exact implementation and evidence
inputs.
