# Screen flows, content IDs, and annotations

This file turns the behavioral inventory into a Figma construction and
prototype contract. It distinguishes what is implemented now from what is
required design coverage. A Figma frame can be required without being a
shipped native route.

Option 2 (`Crew Board`) is the only visual direction for every frame in this
file. Earlier alternatives must not be selected, blended, or kept as parallel
native directions.

## Delivery-status vocabulary

Use one of these exact labels on every screen section in `00 Contract`:

| Label                   | Meaning                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NATIVE-CURRENT-ROUTED` | A native screen exists in the current app navigation and has automated coverage                                   |
| `NATIVE-CURRENT-VIEW`   | A native view and fixture exist, but it is not claimed as a complete routed vertical                              |
| `VISUAL-EVIDENCE-IOS`   | A persistent iOS simulator screenshot exists for the named fixture/state                                          |
| `DATA-CURRENT`          | The named Gateway, SQLite, and Outbox contract is current; this does not imply a screen exists                    |
| `DESIGN-REQUIRED`       | The inventory requires the Figma state/prototype, but native delivery is not claimed                              |
| `CONTRACT-PLANNED`      | A named API/mutation/data behavior is still planned; the frame may illustrate it only with a `PENDING` annotation |

The current routed native set is `SCR-001`, `SCR-002`, the new-root and
existing-draft slices of `SCR-003`, `SCR-004`, `SCR-013`, `SCR-022`, `SCR-023`,
`SCR-031`, `SCR-032`, `SCR-033`, the root text-feed/composer slices of
`SCR-040/041`, `SCR-060`, `SCR-061`, `SCR-062`, the role-composed
`SCR-070/071/072` route, and the safe unavailable route represented by
`SCR-080`. `NATIVE-CURRENT-ROUTED` means registered production navigation plus
automated coverage; it does not imply every route has a discoverable Hub entry,
Android rendering, full state coverage, or release evidence. All uncaptured
state/platform variants remain `DESIGN-REQUIRED` unless their own vertical
evidence says otherwise.

The current `EventSetupRecovery` route supplies only the narrow online
template, default-capability, and primary-place actions required by `SCR-013`.
It does not make the generalized `SCR-011` or `SCR-012` editor contracts current.

## Current runtime route crosswalk

This table mirrors `RootStackParamList`. The product-contract check rejects a
registered route without a row and a row whose route no longer exists.
Qualifiers keep partial current slices from becoming full-screen delivery
claims.

| Runtime route | Catalog coverage |
| ------------- | ---------------- |
| `Events` | `SCR-001` |
| `CreateEvent` | `SCR-002`; new-root `SCR-003` |
| `EventBasicsEdit` | existing-draft `SCR-003` |
| `EventInbound` | `SCR-004` |
| `EventPublish` | `SCR-013` |
| `EventSetupRecovery` | narrow recovery in `SCR-013` |
| `ItemInbound` | inbound gate for `SCR-014`; full screen remains design-required |
| `FeedInbound` | inbound gate for `SCR-040` |
| `FeedbackInbound` | inbound gate for `SCR-061` |
| `FeedbackCompose` | `SCR-060` |
| `CommunityFeedbackList` | `SCR-062` |
| `CommunityFeedbackItem` | `SCR-061` |
| `RecapInbound` | role-composed `SCR-070`, `SCR-071`, and `SCR-072` |
| `GolfScorecard` | `SCR-031` |
| `TeamFeed` | root text-feed/composer slices of `SCR-040` and `SCR-041` |
| `NativeE2EEvidence` | `EVIDENCE-ONLY` development proof surface |
| `TeamSetup` | `SCR-032` |
| `Decision` | `SCR-033` |
| `InvitePreview` | `SCR-022`; `SCR-024` redemption contract only |
| `SignIn` | request slice of `SCR-023` |
| `EmailIdentity` | redemption slice of `SCR-023` |
| `Unavailable` | `SCR-080` |

## Screen registry and copy namespaces

Copy IDs are stable addresses into the
[UX copy matrix](../../marketing/ux-copy-matrix.md), not a second translation.
Use these forms:

- title: `COPY-<SCR-ID>-TITLE-<DE|EN>`;
- primary action: `COPY-<SCR-ID>-CTA-<STATE>-<DE|EN>`;
- state body: `COPY-<SCR-ID>-BODY-<STATE>-<DE|EN>`;
- accessibility: `A11Y-<SCR-ID>-<ELEMENT-OR-STATE>-<DE|EN>`.

`<STATE>` is the uppercase hyphenated state name from `ST-<SCR-ID>`, for
example `OFFLINE`, `QUEUED`, `CONFLICT`, or `PERMISSION-REMOVAL`. Keep
placeholders such as `{event}`, `{time}`, and `{role}` intact in component
masters and replace them only in a named fixture instance.

| Screen    | Human name                  | Copy namespace   | Current handoff status                                                                                                                                                                 |
| --------- | --------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCR-001` | Events                      | `COPY-SCR-001-*` | `NATIVE-CURRENT-ROUTED`; current native logout confirmation, pending, and retry states; remaining state frames `DESIGN-REQUIRED`                                                       |
| `SCR-002` | Starting shape              | `COPY-SCR-002-*` | `NATIVE-CURRENT-ROUTED` inside `CreateEvent`; remaining template/state variants `DESIGN-REQUIRED`                                                                                      |
| `SCR-003` | Event details editor        | `COPY-SCR-003-*` | new-root and existing-draft `NATIVE-CURRENT-ROUTED`; remaining state variants `DESIGN-REQUIRED`                                                                                        |
| `SCR-004` | Event hub and action center | `COPY-SCR-004-*` | `NATIVE-CURRENT-ROUTED`, `VISUAL-EVIDENCE-IOS` for participant baseline/feed                                                                                                           |
| `SCR-010` | Plan tree and timeline      | `COPY-SCR-010-*` | `DESIGN-REQUIRED`                                                                                                                                                                      |
| `SCR-011` | Plan item editor            | `COPY-SCR-011-*` | `DESIGN-REQUIRED`                                                                                                                                                                      |
| `SCR-012` | Capability setup            | `COPY-SCR-012-*` | `DESIGN-REQUIRED`                                                                                                                                                                      |
| `SCR-013` | Readiness review            | `COPY-SCR-013-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; basics plus narrow template/capability/place recovery actions are code/test current; native/device and service-backed publish evidence pending |
| `SCR-014` | Live item detail            | `COPY-SCR-014-*` | inbound gate exists; full screen `DESIGN-REQUIRED`                                                                                                                                     |
| `SCR-020` | Invite manager              | `COPY-SCR-020-*` | `DATA-CURRENT`; native screen `DESIGN-REQUIRED`                                                                                                                                        |
| `SCR-021` | Invite editor               | `COPY-SCR-021-*` | `DATA-CURRENT`; native screen `DESIGN-REQUIRED`                                                                                                                                        |
| `SCR-022` | Invite preview              | `COPY-SCR-022-*` | `NATIVE-CURRENT-ROUTED`; state expansion `DESIGN-REQUIRED`                                                                                                                             |
| `SCR-023` | Email identity              | `COPY-SCR-023-*` | `NATIVE-CURRENT-ROUTED`; state expansion `DESIGN-REQUIRED`                                                                                                                             |
| `SCR-024` | Invitation acceptance       | `COPY-SCR-024-*` | redemption contract current; full screen `DESIGN-REQUIRED`                                                                                                                             |
| `SCR-025` | Offline download            | `COPY-SCR-025-*` | data seams current; full screen `DESIGN-REQUIRED`                                                                                                                                      |
| `SCR-030` | Personal action form        | `COPY-SCR-030-*` | `CONTRACT-PLANNED`, `DESIGN-REQUIRED`                                                                                                                                                  |
| `SCR-031` | Golf scorecard              | `COPY-SCR-031-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; queued, conflict, read-only and Accessibility Large `VISUAL-EVIDENCE-IOS`; remaining state/platform variants `DESIGN-REQUIRED`                |
| `SCR-032` | Team collaboration setup    | `COPY-SCR-032-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`, organizer `VISUAL-EVIDENCE-IOS`; discoverable Hub entry, remaining states and Android `DESIGN-REQUIRED`                                      |
| `SCR-033` | Team decision               | `COPY-SCR-033-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`, closed-attention participant `VISUAL-EVIDENCE-IOS`; discoverable Hub entry, remaining states and Android `DESIGN-REQUIRED`                   |
| `SCR-040` | Event feed                  | `COPY-SCR-040-*` | root text-feed slice `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; target, media, reaction, and remaining state variants `DESIGN-REQUIRED`                                                  |
| `SCR-041` | Feed composer               | `COPY-SCR-041-*` | root text composer `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; photo, edit, target, and remaining state variants `DESIGN-REQUIRED`                                                        |
| `SCR-050` | Sync center                 | `COPY-SCR-050-*` | sync/outbox data current; full screen `DESIGN-REQUIRED`                                                                                                                                |
| `SCR-051` | Conflict resolver           | `COPY-SCR-051-*` | conflict data current; full screen `DESIGN-REQUIRED`                                                                                                                                   |
| `SCR-060` | Feedback compose            | `COPY-SCR-060-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; consented screenshot and duplicate suggestions current; native/device and service-backed evidence pending                                    |
| `SCR-061` | Feedback item               | `COPY-SCR-061-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; vote/comment/follow writes are online-only; native/device and service-backed evidence pending                                                 |
| `SCR-062` | Event feedback              | `COPY-SCR-062-*` | `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`; account/root cached reports and updates current; native/device and service-backed evidence pending                                            |
| `SCR-070` | Recap status                | `COPY-SCR-070-*` | role-composed `NATIVE-CURRENT-ROUTED`, `DATA-CURRENT`, manager/member `VISUAL-EVIDENCE-IOS`; remaining states `DESIGN-REQUIRED`                                                       |
| `SCR-071` | Recap editor                | `COPY-SCR-071-*` | generated review/publish/remove `NATIVE-CURRENT-ROUTED`; manual draft mutation `CONTRACT-PLANNED`, remaining states `DESIGN-REQUIRED`                                                 |
| `SCR-072` | Recap viewer                | `COPY-SCR-072-*` | protected member view and manager share/revoke `NATIVE-CURRENT-ROUTED` with `VISUAL-EVIDENCE-IOS`; public consumer and Android `DESIGN-REQUIRED`                                      |
| `SCR-080` | Access unavailable          | `COPY-SCR-080-*` | safe native route current; role/public variants `DESIGN-REQUIRED`                                                                                                                      |

## Current fixture registry

Do not modify fixture content inside a reference frame. Create a new
`FIX-*` delta for a new role/state.

### `FIX-EH-TURKEY-GOLF-PARTICIPANT-READY`

- Source: `turkeyGolfEventHubModel` in
  [EventHubView.tsx](../../../apps/mobile/src/screens/EventHubView.tsx)
- Frame: `Evidence/SCR-004/participant/ready/A-IOS-390`
- Content: `Turkey Golf Tour`, `Belek`, `20.–24. September 2026`, eight
  participants, `Welcome Dinner` at `18:30`, timeline at `09:00` and `13:30`,
  Marco feed update `vor 28 Min.`
- Delivery: `Offline bereit · vor 2 Min. synchronisiert`
- Primary action: `COPY-SCR-004-CTA-READY-DE` = `Route öffnen`
- Read-only action ID: `route-welcome-dinner`
- Source data: background `API-S2`; `SQL-ROOTS`, `SQL-GRAPH`, `SQL-PLAN`,
  `SQL-ACTIONS`, `SQL-FEED`, `SQL-SYNC`, `SQL-RECAP`; no write mutation

### `FIX-GOLF-CARYA-PARTICIPANT-QUEUED`

- Source: [Golf evidence entry](../../../apps/mobile/evidence/golf-scorecard-option-2-entry.js)
- Frame: `Evidence/SCR-031/participant/queued/A-IOS-390`
- IDs: root `evt_golf-tour`, round `evt_carya-round`; participant owns one
  18-hole scorecard and hole 1 is selected
- Content: `1. Runde · Carya Golf Club`, Par 4, HCP 1, four strokes, one putt,
  local Stableford result of three points and a three-player leaderboard
- Delivery: `1 Änderung lokal gespeichert`; the selected hole remains visibly
  `LOKAL GESPEICHERT` until authoritative sync confirms delivery
- Primary action: `Loch lokal speichern`; `Werte leeren` explicitly clears the
  same stable hole intent
- Data: production `SQL-GOLF`, `SQL-OUTBOX`, `SQL-SYNC`, one
  `MobileSyncEngine`; the fixture exists only in the evidence entry

### `FIX-GOLF-CARYA-CONFLICT-AND-READ-ONLY`

- Base: `FIX-GOLF-CARYA-PARTICIPANT-QUEUED`
- Conflict frame: `Evidence/SCR-031/participant/conflict/A-IOS-390`; local
  five strokes/two putts/two points and server four strokes/one putt/three
  points stay visible together; `Meinen Stand erneut senden` creates a fresh
  durable replacement before the old deadletter can be discarded
- Read-only frame: `Evidence/SCR-031/organizer/read-only/A-IOS-390`; score
  inputs and write controls are absent, while the full ranking stays visible
- Accessibility frames: queued top and real-scroll editor continuation at iOS
  Accessibility Large; the visual heading breaks semantically as `Score-` /
  `karte` while its accessibility label remains `Scorekarte`
- Boundary: persistent iOS evidence does not claim Android rendering or a real
  service-backed disconnect/reconnect device journey

### `FIX-TEAM-ASSIGNMENTS-ORGANIZER-LOCAL`

- Source: [team evidence entry](../../../apps/mobile/evidence/team-collaboration-option-2-entry.js)
- Frame: `Evidence/SCR-032/organizer/local-unpublished/A-IOS-390`
- IDs: root `evt_team_retreat`, event `evt_team_session`; teams
  `ttm_lavender` and `ttm_mint`
- Content: `Belek Team Retreat`; Lavendel = Lena + Marco, Mint = Aylin +
  David; capacity three each
- Delivery: visible evidence says `Nicht veröffentlicht · lokal gespeichert`
- Primary action: `COPY-SCR-032-CTA-OFFLINE-DE` =
  `Einteilung veröffentlichen`
- Data: `API-S3`, `M-team.assignments.publish`, `SQL-TEAM`, `SQL-OUTBOX`,
  `SQL-SYNC`; remains unpublished until confirmed

### `FIX-TEAM-DECISION-PARTICIPANT-CLOSED-ATTENTION`

- Source: [team evidence entry](../../../apps/mobile/evidence/team-collaboration-option-2-entry.js)
- Frame: `Evidence/SCR-033/participant/closed-attention/A-IOS-390`
- IDs: root `evt_team_retreat`, event `evt_team_session`, decision
  `tdc_team_challenge`, local mutation `mutation-local-response`
- Content: question `Welche Team-Challenge starten wir?`; selected
  `tdo_outdoor`; other options `tdo_cooking`, `tdo_quiz`; eight confirmed
  responses
- Delivery: `Aktion erforderlich · Auswahl lokal erhalten`
- Primary action: `COPY-SCR-033-CTA-CLOSED-DE` for the closed/read
  path = `Ergebnis ansehen`
- Data: `API-S3`, `M-team.response.set`, `SQL-TEAM`, `SQL-OUTBOX`, `SQL-SYNC`;
  local choice remains visible, selection controls are read-only

### `FIX-RECAP-MANAGER-PUBLISHED`

- Source: [Recap evidence entry](../../../apps/mobile/evidence/recap-option-2-entry.js)
- Frame: `Evidence/SCR-072/organizer/published/A-IOS-390`
- Content: `Turkey Golf Tour`, `Eure Momente`, two source-derived titled
  moments, reviewed published phase, active manager role
- Delivery: current online member projection; external disclosure is explicitly
  title-only and limited to seven days
- Primary action: current production copy `Titel-Link teilen`; after creation,
  `Link erneut teilen`
- Data: generated-client `API-R1/R5/R6`, account/root `SQL-RECAP`; share token
  remains only in the successful response/current React state and never enters
  SQLite, navigation, diagnostics, or `SQL-OUTBOX`

### `FIX-RECAP-PARTICIPANT-PUBLISHED-OFFLINE`

- Source: [Recap evidence entry](../../../apps/mobile/evidence/recap-option-2-entry.js)
- Frame: `Evidence/SCR-072/participant/published-offline/A-IOS-390`
- Content: the exact authorized published recap snapshot for `Turkey Golf Tour`;
  no draft, remove, publish, or share control
- Delivery: account/root-scoped cached member view with explicit offline truth
- Primary action: current production copy `Online prüfen`; no command is queued
- Data: `SQL-RECAP` protected member snapshot; public `API-R7` projection and
  share tokens are never cached

### State fixture deltas

Name additional fixtures
`FIX-<SCR-ID>-<role>-<state>`. A delta must list base fixture, changed fields,
typed error or delivery state, current/planned data owner, and exact primary
action copy ID. Never create a frame named only `Error` or `Offline`.

## Organizer prototype lanes

| Lane                   | Journey IDs               | Required route chain                                                                                           |
| ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Create and publish     | `O-01` through `O-08`     | `SCR-001 -> SCR-002 -> SCR-003 -> SCR-004 -> SCR-010/011/012/013 -> OVR-006/007`                               |
| Golf setup and publish | `G-O-01` through `G-O-03` | `SCR-010 -> OVR-001/003/005 -> SCR-011/012 -> SCR-040`                                                         |
| Team setup and publish | `T-O-01` through `T-O-03` | `SCR-010 -> OVR-001/002/003 -> SCR-011/032/033 -> SCR-014/040`                                                 |
| Community management   | `C-02`, `C-03`            | `SCR-040 -> SCR-041 -> OVR-008/009/011 -> SCR-051`                                                             |
| Sync and recovery      | `S-02` through `S-05`     | writable surface -> `CMP-002/010 -> OVR-011 -> SCR-050 -> SCR-051`                                             |
| Feedback               | `F-01` through `F-03`     | current Hub -> `SCR-062 -> SCR-060/061`; selected duplicate -> `SCR-061`, with separate screenshot/diagnostics consent |
| Recap                  | `R-O-01`, `R-O-02`        | Current: `SCR-070 -> SCR-071 -> OVR-006 -> SCR-072 -> OVR-007`; planned manual-highlight branch adds `OVR-014` |

The organizer Team prototype starts at
`Flow/T-O-02/organizer/local-unpublished`, exposes named move controls, then
uses one publish action. The current evidence transition to the participant
decision is an evidence harness transition, not a claim that production
navigation already connects those screens.

## Participant prototype lanes

| Lane                          | Journey IDs                | Required route chain                                                     |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| Invite and first offline open | `P-01` through `P-04`      | `SCR-022 -> SCR-023 -> SCR-024 -> SCR-025 -> SCR-004`                    |
| Next action                   | `P-05`, `G-P-01`, `T-P-01` | `SCR-004 -> SCR-030`, with queued/changed/removal recovery               |
| Live event                    | `G-P-02`, `T-P-02`         | `SCR-004 -> SCR-014`, including moved/cancelled/tombstone                |
| Golf scoring                  | `G-P-03`                   | `SCR-031 -> SCR-051` through offline, restart, sync, duplicate, conflict |
| Team decision                 | `T-P-03`                   | `SCR-033` open, queued, closed, closed-during-outage, conflict, viewer   |
| Community                     | `C-01` through `C-03`      | Gate -> `SCR-040/014`, composer/actions only when role permits           |
| Sync and recovery             | `S-01` through `S-05`      | `CMP-001 -> OVR-010/011 -> SCR-050/051`                                  |
| Feedback                      | `F-01` through `F-03`      | current Hub -> `SCR-062 -> SCR-060/061`; selected duplicate -> `SCR-061` |
| Recap                         | `R-P-01`                   | `SCR-070 -> SCR-072`; participant cannot create a public share link      |

## Annotation grammar

Every frame gets a right-side annotation stack outside the export bounds. Each
note begins with one of these visible labels; label text remains present even
if Figma also colors note categories.

| Note kind     | Required content                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `ROLE`        | role, capability, absent controls, and downgrade/removal result                                 |
| `COPY`        | title, primary action, state body, and a11y copy IDs                                            |
| `FIXTURE`     | base `FIX-*`, changed fields, localized date/time assumptions                                   |
| `API`         | `API-*`, Current/Planned, method/operation when relevant, online-only behavior                  |
| `SQL`         | account/root-scoped `SQL-*` read model and atomic visibility boundary                           |
| `OUTBOX`      | mutation label, idempotency, queued/unpublished wording, dependency/retry/dead-letter behavior  |
| `INTERACTION` | entry, exit, back, scroll/fixed regions, hotspot result, native surface handoff                 |
| `A11Y`        | initial/changed focus, reading order, accessible names/states, announcement, 200% text behavior |
| `OFFLINE`     | what remains readable/editable, whether a write queues, and what requires online                |
| `ERROR`       | typed failure, retained input/data, recovery action, safe wording                               |
| `CONFLICT`    | local/current values, selection model, tombstone/concealment, second-race behavior              |
| `PRIVACY`     | hidden data, generic unavailable copy, token/log/clipboard restrictions                         |
| `PENDING`     | named Bead or missing evidence; never worded as shipped behavior                                |

### Annotation card template

```text
ROLE: participant · can read and respond · no manager roster
COPY: COPY-SCR-033-TITLE-DE · COPY-SCR-033-CTA-QUEUED-DE
FIXTURE: FIX-SCR-033-participant-queued
API: API-S3 · Current · delivery only
SQL: SQL-TEAM + SQL-SYNC · same account/root
OUTBOX: M-team.response.set · Queued, not delivered
INTERACTION: select one option -> primary action -> return to session
A11Y: heading -> lifecycle -> sync -> question -> radio choices -> CTA
OFFLINE: choice remains editable; submit commits locally
ERROR: retained choice -> Retry now
CONFLICT: response/decision changed -> Review response
```

## Data and delivery annotation rules

- Screens observe SQLite, not a screen-owned network cache. A Gateway response
  becomes visible only after its SQLite transaction commits.
- Mark `API-S3` Current only with a current mutation label. A generic push route
  does not make a planned mutation available.
- A local commit is `Queued` or `Unpublished`, never delivered. `Synced` requires
  pull confirmation of the server revision.
- Root/account boundaries are part of every `SQL-*` note. Do not show another
  account's Outbox, roster, private response, or concealed server value.
- Invitation redemption, sign-in/refresh, unseen-root bootstrap, publication,
  and public recap link create/revoke/resolve are online-only.
- Conflict frames preserve both versions and require an explicit field-wise or
  source-aware decision. No frame silently discards local work.
- Permission/removal frames retain only the person's permitted local draft or
  export path and conceal private server content.

## Interaction and accessibility prototype rules

- One primary action per frame. A mutually exclusive state replaces the action;
  it does not add a second primary button.
- Prototype links follow the inventory Navigation Graph and deep-link matrix,
  including auth return, bootstrap before private content, tombstones,
  canonical feedback redirect, and generic recap-link failure.
- Initial focus is heading, then current status, content, primary action. A
  validation error focuses the first invalid field; a conflict or permission
  change focuses its state heading.
- Status announcements are polite and occur once per meaningful transition.
  Progress announcements are bounded.
- Every icon-only button has a name; radio, tab, selected, checked, disabled,
  busy, and expanded states are annotated.
- Every essential swipe, drag, or reorder interaction has a named control.
- Keyboard-open frames keep the focused field and its error above the native
  keyboard; the keyboard consumes the bottom safe area.
