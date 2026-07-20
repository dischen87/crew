# Events switching — Option 2 evidence

This folder is the persistent visual and implementation evidence for
`crew-paq.3.5.2` and its durable-index follow-up `crew-paq.3.5.5`. The
production-routed Events screen uses the selected Crew Board Option-2 language
while preserving the actor-authorized, Gateway-only `eventRootsList` boundary.

## Result

- `EventsView` is a pure rendering surface for loading, permitted-empty,
  retryable error, fresh, refreshing, and explicit offline states. The
  production controller contains no fixture or demo roots.
- An account-scoped SQLite index stores active, non-archived root summaries,
  versioned refresh metadata, and the exact selected `rootEventId`. It survives
  process restart without using a title as identity.
- The index requests only `eventRootsList` through the generated mobile Gateway
  client, with `includeArchived: 'false'`. Neither the switcher nor Event Hub
  calls an event service directly.
- Each card opens `EventInbound` with its exact `rootEventId`. Roles,
  lifecycle, membership state, and dates remain visible as text rather than
  color alone.
- The switcher does not show create or join controls because neither capability
  is currently routed here. The real creation journey is tracked separately as
  `crew-paq.3.5.4`.
- The implementation uses the shared Option-2 tokens and primitives, the Crew
  logo, and checked-in raster icons. There are no emoji or handcrafted visible
  assets.

## Persistent evidence

| Evidence                                                                                         | Purpose                                                                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| [Ready state, 390 x 844](./01-events-ready-390x844.png)                                          | Exact normalized comparison viewport                                              |
| [Ready state, 1170 x 2532](./01-events-ready-1170x2532.png)                                      | Physical simulator screenshot at 3x                                               |
| [Accessibility Large, 390 x 844](./02-events-accessibility-large-390x844.png)                    | Near-200% iOS content-size proof with scrollable cards and no horizontal clipping |
| [Accessibility Large, 1170 x 2532](./02-events-accessibility-large-1170x2532.png)                | Unscaled simulator accessibility capture                                          |
| [Offline index, 390 x 844](./03-events-offline-390x844.png)                                      | Durable cached-root state, refresh time, and functional refresh control           |
| [Offline index, 1170 x 2532](./03-events-offline-1170x2532.png)                                  | Physical simulator screenshot at 3x                                               |
| [Offline index at 200% text, 390 x 844](./04-events-offline-accessibility-large-390x844.png)     | Scrollable near-200% state without horizontal clipping                            |
| [Offline index at 200% text, 1170 x 2532](./04-events-offline-accessibility-large-1170x2532.png) | Unscaled simulator accessibility capture                                          |
| [Source and implementation comparison](./comparison-source-vs-events.png)                        | Binding Option-2 source and implementation kept at exact 1:1 390 x 844 panels     |
| [Design QA](./design-qa.md)                                                                      | Severity review and comparison history                                            |

The isolated evidence entry uses two realistic, clearly synthetic root records:
`evt_turkey_golf` and `evt_belek_team_retreat`. That fixture lives only in
`apps/mobile/evidence/events-option-2-entry.js`. The offline fixture is isolated
in `apps/mobile/evidence/events-actor-index-offline-entry.js`; production data
binding is proved separately by controller and SQLite tests.

## Accessibility and state coverage

- Cards have button semantics, descriptive labels, and at least 48-point touch
  targets.
- Event titles, metadata, chips, and section headers wrap; no relevant text is
  truncated or given a restrictive font multiplier.
- Owner, organizer, participant, and viewer roles plus draft, published, and
  cancelled lifecycle labels are covered in the pure-view test. Store tests
  prove that archived, left, and removed roots never enter the rendered index.
- Loading and permitted-empty states expose no fake action. Retryable errors
  expose one honest retry action, while an unavailable Gateway client does not.
- The iOS `accessibility-large` capture is the platform's near-200% body-text
  category, not a claim that every display style uses one uniform 2.0
  multiplier. The content remains vertically scrollable at that category.

## Durable offline boundary

The root index is now an account-scoped SQLite projection. Refresh is paginated,
bounded, and atomic; malformed or transient responses retain the last complete
cache. An authoritative collection denial or an absent root removes the
affected projections, sanitized member directory, and durable selection in one
scope. Account switch and logout tests prove that an in-flight response cannot
write or navigate under another account. Event Hub renders only a root present
in this index together with its account-scoped SQLite projections.

## Reproduction notes

The Release simulator app was bundled with each isolated evidence entry,
installed on the iPhone 16e simulator, and captured at 1170 x 2532 pixels. Each
artifact was then normalized to exactly 390 x 844 without cropping. The
simulator content size was verified as `large` after the accessibility capture.
`asset-manifest.sha256` records the exact evidence inputs and outputs.
