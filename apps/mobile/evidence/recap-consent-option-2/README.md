# Recap external consent — Option 2 native evidence

This folder records the iOS visual acceptance matrix for the server-owned
`GET /recap` external-consent projection. The deterministic entry
`apps/mobile/evidence/recap-consent-option-2-entry.js` renders the production
`RecapView` with fixed role, authority, decision and offline states.

## Accepted matrix

| Evidence                                                                                     | Acceptance job                                                                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Manager grant, top](./manager-grant-top-390x844.png)                                        | Published organizer hierarchy and event-body manager grant                                |
| [Manager grant, actions](./manager-grant-actions-390x844.png)                                | Exact body preview, selection control, and only the server-projected manager capability   |
| [Manager withdraw](./manager-withdraw-feed-390x844.png)                                      | Feed body with author grant plus manager withdrawal and manager actions                   |
| [Feed author](./feed-author-actions-390x844.png)                                             | Participant-author can decide only the required author authority                          |
| [Participant, top](./participant-top-390x844.png) and [feed](./participant-feed-390x844.png) | Non-author participant sees current server statuses without selection or decision actions |
| [Viewer, top](./viewer-top-390x844.png) and [feed](./viewer-feed-390x844.png)                | Viewer sees current server statuses without mutation controls                             |
| [Offline drift](./drift-offline-top-390x844.png)                                             | Projection is fail-closed to unknown with an explicit online recheck action               |

Every normalized image has an uncropped 1170 x 2532 counterpart in `raw/`.
The captures came from an isolated exact iPhone 16e simulator on iOS 26.2,
light appearance and medium text size. The 390 x 844 derivatives are no-crop
resizes of the simulator's exact 3x viewport.

## Visual review

The binding Option-2 source
`../event-hub-option-2/reference-390x844.png` and the current Recap captures
were opened together at the same 390 x 844 viewport. The production view keeps
the shared lavender board, ink outlines, mint actions, gold selection state,
DM Sans typography, oversized cards and direct German copy. No P0, P1 or P2
visual issue remained in this slice. See `design-qa.md` for the state-by-state
review and evidence limits.

## Build and behavior boundary

The entry was freshly bundled into a copied Release simulator shell under the
isolated bundle ID `app.crew.next.recapconsent.evidence`, ad-hoc signed, and
installed only on the isolated simulator. It initializes no Gateway, database,
Keychain, account session or production controller. The shell is therefore
Release-shaped native visual evidence, not a production deployment and not
proof of a live backend mutation.

Behavior is bound separately by the frozen focused gates:

- mobile-data Recap: 9 tests, 72 assertions;
- mobile Recap screen and view: 19 tests across 2 suites;
- full mobile-data: 142 tests, 998 assertions;
- mobile-data and mobile lint and TypeScript: passed.

Those gates cover ordinal-only binding, semantic projection validation,
no-SQLite persistence, action derivation solely from `actorCanDecide`,
grant/withdraw refetch, and fail-closed null, offline, drift and refresh-error
paths. `native-visual-proof.json` records the exact build, source hashes,
device, matrix and evidence boundary. `asset-manifest.sha256` binds the durable
inputs and outputs.

## Reproduction helpers

- `maestro-scroll.yaml` launches the isolated app and scrolls a requested
  matrix label fully into view.
- `maestro-top.yaml` restores the Recap heading for a deterministic top-state
  capture.

The isolated simulator and temporary copied app were deleted after capture;
no shared Crew simulator, app data, Metro process or debug installation was
used or changed.
