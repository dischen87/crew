# Crew Next Option 2 Figma handoff

- Status: Build-ready; Event Hub, durable offline Events, auth/recovery,
  production Team, production Recap, and native scaffold evidence linked
- Date: 2026-07-19
- Bead: `crew-paq.4.6`
- Visual direction: Option 2, **Crew Board**
- Product language: German source, English meaning-equivalent
- Product surfaces: mobile only

This directory is the entry point for recreating Crew Next in Figma without
inventing product behavior. It binds the selected Option 2 visual language to
the existing screen, copy, API, SQLite, Outbox, accessibility, and offline
contracts. It is a handoff package, not a Figma export or a new product spec.

## Binding source order

If two sources appear to disagree, use the first applicable source in this
table and record the mismatch. Do not silently combine alternatives.

| Priority | Source                                                     | Owns                                                                                                                 |
| -------: | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
|        1 | [Screen and state inventory](../figma-screen-inventory.md) | Routes, roles, states, one-primary-action rule, API/SQLite/Outbox IDs, focus, deep links, overlays, journey coverage |
|        2 | [UX copy matrix](../../marketing/ux-copy-matrix.md)        | German and English copy, placeholders, permission-safe language, announcements                                       |
|        3 | [Foundations](./01-foundations.md)                         | Option 2 artboards, safe areas, variables, text styles, effects, dimensions, assets                                  |
|        4 | [Components](./02-components.md)                           | Primitive and `CMP-*` mapping, variants, states, Figma component properties                                          |
|        5 | [Flows and annotations](./03-flows-and-annotations.md)     | Figma naming, copy IDs, fixture IDs, role lanes, annotation grammar, prototype links                                 |
|        6 | [Evidence and provenance](./04-evidence-and-provenance.md) | Persistent rendered screens, reference comparison, fonts, icons, images, checksums                                   |

The implementation sources are [theme.ts](../../../apps/mobile/src/design/theme.ts),
[primitives.tsx](../../../apps/mobile/src/design/primitives.tsx), and the
[mobile screen directory](../../../apps/mobile/src/screens/). Figma never
overrides a typed permission, delivery, or data contract in those sources.

## Exact Figma file structure

Create these six pages, in this order and with these names:

| Page                 | Required sections                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `00 Contract`        | Cover, source order, artboards, naming rules, copy/fixture registry, annotation legend, evidence links, open provenance notes        |
| `01 Components`      | Option 2 variables and styles, app-local primitives, `CMP-001` through `CMP-020`, every required variant/state                       |
| `02 Screens iOS`     | Every non-dash `ST-*` state on `A-IOS`; role/content variants; the 390 x 844 evidence frames in a clearly labelled reference section |
| `03 Screens Android` | The same state and role coverage on `A-AND`; native system surfaces referenced, never redrawn                                        |
| `04 Overlays`        | `OVR-001` through `OVR-015`; app-owned sheets on platform artboards; native surfaces as linked notes                                 |
| `05 Prototype`       | Organizer, participant, deep-link, sync/conflict, Community, feedback, and recap traces from the inventory                           |

Do not add desktop pages. `A-COMPACT` is a 200% text and clipping check inside
the contract page, not another visual direction.

## Frame and component naming

- Screen: `Screen/<SCR-ID>/<role>/<state>/<A-IOS|A-AND>`
- 390 evidence: `Evidence/<SCR-ID>/<role>/<state>/A-IOS-390`
- Overlay: `Overlay/<OVR-ID>/<state>/<A-IOS|A-AND>`
- Component: `Component/<CMP-or-PRIM-ID>/<variant>/<state>`
- Prototype start: `Flow/<journey-ID>/<role>/<start-state>`
- Annotation: `Note/<kind>/<source-ID>`

Allowed role segments are `owner`, `organizer`, `participant`, `viewer`, and
`public`. Use `prospective-owner` only before a root exists. Use source IDs
verbatim; never replace `SCR-032`, for example, with a human-only name.

## Reconstruction sequence

1. Create all artboards, layout grids, variables, text styles, and effects from
   [Foundations](./01-foundations.md).
2. Create every app-local primitive and its states from
   [Components](./02-components.md). Build screens only from these components
   and the twenty behavioral `CMP-*` sets.
3. Place the persistent Option 2 reference and implementation images at their
   native 390 x 844 size with no scaling or crop.
4. Build the baseline Event Hub, durable Events switcher,
   auth/invite/recovery, organizer Team assignment, participant Team decision,
   and role-composed Recap fixtures before multiplying state frames.
5. Duplicate only by role or state when the inventory requires a content,
   permission, recovery, or delivery difference.
6. Add the labelled annotations before connecting prototype hotspots.
7. Run the frame-level acceptance checklist below on both platform pages.

## Frame-level acceptance checklist

Every screen frame must show or annotate all of the following:

- exact `SCR-*`, role, state, and artboard in the frame name;
- one and only one primary action, with its exact `COPY-*` ID;
- `FIX-*` ID or a complete fixture delta;
- applicable `API-*`, `SQL-*`, mutation, and Outbox truth;
- visible delivery wording; never status by color or motion alone;
- entry, exit, back behavior, and fixed-versus-scrolling regions;
- initial focus, changed-state focus, reading order, accessible control names,
  and a minimum 48 x 48 point interactive target;
- offline, error, conflict, removal, or online-only behavior when applicable;
- no disabled write control for a viewer when the correct design is to omit it;
- `A-COMPACT` evidence at 200% text for title, status, error, and primary action.

The full quantitative acceptance remains the
[Figma handoff acceptance section](../figma-screen-inventory.md#figma-handoff-acceptance):
30 screens, 15 overlays, 20 behavioral component sets, every applicable state
on iOS and Android, and all 39 traced journeys.

## Handoff readiness

| Area                               | Status                   | Evidence                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option 2 visual reference          | Ready                    | Persistent reference and same-input comparisons in [Evidence](./04-evidence-and-provenance.md)                                                                                                                               |
| Event Hub participant baseline     | Ready                    | Unscrolled and feed-revealed 390 x 844 captures                                                                                                                                                                              |
| Events / event switching           | Ready                    | Routed ready, durable cached/offline index, normal and 200%-text states, and same-input comparison                                                                                                                           |
| Auth, invite, access, and recovery | Ready                    | Production-controller states, privacy/recovery distinctions, 200%-text evidence, and two same-input comparisons                                                                                                              |
| Tokens and app-local primitives    | Ready                    | Exact source-backed tables, including `TextField` and `FeedUpdateRow`                                                                                                                                                        |
| Organizer/participant behavior     | Ready                    | `SCR-*`, `ST-*`, `OVR-*`, journey, copy, data, and annotation contracts                                                                                                                                                      |
| Existing-draft basics blocker path | Pending runtime evidence | Production route and focused/full code tests cover title/description/start/end editing, offline restart, conflict, cross-runtime lock, DST folds, and return refetch; native 390 x 844 and large-text capture remain pending |
| Production Team assignment screen  | Ready                    | Routed account/root SQLCipher state, member-directory fallback, native move/publish evidence, and same-input comparison in [Evidence](./04-evidence-and-provenance.md)                                                       |
| Production Team decision screen    | Ready                    | Routed role guard, native 390 x 844 state, and passing iPhone 16e Maestro accessibility path                                                                                                                                 |
| Production Recap lifecycle         | Ready                    | Routed owner/organizer generate-review-publish-remove-share-revoke, participant/viewer published-only read, authorized offline cache, two same-input comparisons, and iOS large-text evidence                                |
| Public recap web/native consumer   | Pending runtime evidence | The title-only online resolver contract is current; this slice does not claim a deployed public consumer, public cache, or participant-created external links                                                                |
| Generic Team conflict Device-E2E   | Pending runtime evidence | The needs-attention design and retry contract are specified; no real service-backed disconnect/reconnect conflict journey is claimed                                                                                         |
| Android native scaffold/data path  | Ready                    | API-36 ARM64 Hermes/Fabric plus native SQLCipher/Keychain probe                                                                                                                                                              |
| Android product-screen comparison  | Pending runtime evidence | `A-AND` is fully specified; Option-2 product screens still need same-state Android captures before visual parity is claimed                                                                                                  |

`Pending runtime evidence` is a visible QA boundary, not a missing design
contract. It is not permission to invent behavior or represent a planned frame
as runtime proof.
