# Option 2 components and states

Build the component library from
[primitives.tsx](../../../apps/mobile/src/design/primitives.tsx). Keep the
property names below so screen instances can be audited against code. Icons are
real nested asset instances supplied by a caller; never substitute emoji,
hand-drawn SVG, text glyphs, or empty placeholder boxes.

## App-local primitive sets

| Figma ID               | Runtime primitive                                | Component properties                                                                                           | Required states                                                 | Measurements and accessibility                                                                                                          |
| ---------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PRIM-BUTTON`          | `Button`                                         | `Variant=Action\|Brand\|Dark\|Surface`, `Icon=On\|Off`, `Loading=On\|Off`                                      | default, pressed, disabled, loading                             | 48 minimum height; 3 border; pill radius; 3 hard shadow, 1 when pressed; visible label is accessible name                               |
| `PRIM-ICON-BUTTON`     | `IconButton`                                     | `Tone=Surface\|Action\|Brand\|Lavender`, required `Icon` instance                                              | default, pressed, disabled                                      | 48 x 48; 3 border; pill radius; required non-visual accessible name                                                                     |
| `PRIM-STATUS-CHIP`     | `StatusChip`                                     | `Tone=Surface\|Action\|Brand\|Lavender`, `Icon=On\|Off`                                                        | each tone with short and wrapping label                         | 28 minimum height; 2 border; pill radius; label carries state, not color                                                                |
| `PRIM-SYNC-STATUS`     | `SyncStatus`                                     | `State=Ready\|Syncing\|Offline\|Attention`, `Icon=On\|Off`                                                     | synced, refreshing, offline, pending, needs attention           | 48 minimum row; 28 indicator; polite live status; full textual truth                                                                    |
| `PRIM-CARD`            | `Card`                                           | `Tone=Surface\|Action\|Brand\|Lavender`, `Elevated=On\|Off`                                                    | flat, elevated, interactive composition, recovery composition   | 20 radius; 3 border; 16 default padding; elevated uses 4 hard shadow                                                                    |
| `PRIM-AVATAR-STACK`    | `AvatarStack`                                    | `Count=0..7+`, `Image=Present\|Fallback`                                                                       | empty, one, overlap, overflow                                   | 40 circles; 10 overlap; max seven visible; one summary label, decorative children hidden                                                |
| `PRIM-TIMELINE-ROW`    | `TimelineRow`                                    | `Interactive=On\|Off`, `Icon=On\|Off`, `Subtitle=On\|Off`, `Trailing=On\|Off`                                  | default, pressed, no icon, wrapping text                        | 72 minimum row; 40 icon; 68 time column; combined time/title/subtitle name                                                              |
| `PRIM-TEXT-FIELD`      | `TextField`                                      | `Support=None\|Help\|Error`, `State=Pristine\|Focused\|Filled\|Disabled`, `Multiline=On\|Off`                  | pristine, focused, filled, help, error, focused-error, disabled | 48 minimum input; 14 radius; 2 border, 3 on focus; visible label; associated hint/error; polite error alert                             |
| `PRIM-FEED-UPDATE-ROW` | `FeedUpdateRow`                                  | `Interactive=On\|Off`, `Unread=On\|Off`, `Body=On\|Off`, `Status=On\|Off`, `Trailing=On\|Off`, required `Icon` | read, unread with text `Neu`, pressed, long body, custom status | 72 minimum row; 40 icon; list-item semantics or named button; unread/status is textual; icon and trailing art hidden from accessibility |
| `PRIM-BOTTOM-NAV`      | `BottomNavigationShell` + `BottomNavigationItem` | `ItemCount=4`, per item `Selected=On\|Off`, `Disabled=On\|Off`, required `Icon`                                | one selected, pressed, disabled                                 | shell uses safe bottom; item minimum 56; tablist/tab semantics; label always visible                                                    |

### `PRIM-TEXT-FIELD` anatomy

Use Auto Layout in this order:

1. visible `type/label` label;
2. input container with `type/body`, 12 horizontal and 8 vertical padding;
3. one optional `type/caption` help or error line.

The error line begins with `Fehler:` in the current German primitive and uses
`color/error`. Focus increases the border from 2 to 3 and uses `color/focus`;
focused-error keeps the 3 border and error color. Disabled makes the native
field non-editable and exposes its disabled state. Do not replace the label
with placeholder text.

### `PRIM-FEED-UPDATE-ROW` anatomy

Use a horizontal 12-point gap:

1. required 40 x 40 real icon instance;
2. flexible copy stack with actor, timestamp, title, optional body, and optional
   status chip;
3. optional decorative trailing instance.

The accessible reading unit is `actor, title, body, timestamp, status`.
Interactive rows are buttons; static rows are list items. The icon and trailing
instance never duplicate that accessible name. `Unread=On` must display the
word `Neu` unless an explicit status label replaces it.

## Behavioral `CMP-*` mapping

The twenty `CMP-*` sets remain mandatory even where a primitive supplies their
visual shell. Use component properties instead of forking a screen.

| Behavioral set                      | Build from                               | Required design responsibility                                                                 |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CMP-001` Global sync status        | `PRIM-SYNC-STATUS`, `PRIM-ICON-BUTTON`   | synced, refreshing, offline + last time, pending count, retrying, needs attention, auth paused |
| `CMP-002` Delivery truth badge      | `PRIM-STATUS-CHIP`                       | Saving, Queued, Uploading, Needs attention, Synced, Unpublished                                |
| `CMP-003` Root card                 | `PRIM-CARD`, `PRIM-STATUS-CHIP`          | lifecycle, role, offline, and delivery before open action                                      |
| `CMP-004` Single action dock        | `PRIM-BUTTON`                            | enabled, local-only, online-required, validating, submitting; exactly one primary action       |
| `CMP-005` Now/next module           | `PRIM-CARD`, `PRIM-BUTTON`               | before/current/next/after, moved/cancelled, empty schedule                                     |
| `CMP-006` Personal action card      | `PRIM-CARD`, `PRIM-STATUS-CHIP`          | pending, partial, queued, complete, changed, withdrawn, permission removed                     |
| `CMP-007` Recursive event row       | `PRIM-TIMELINE-ROW`                      | hierarchy, position, expanded state, visible reorder controls                                  |
| `CMP-008` Itinerary row             | `PRIM-TIMELINE-ROW`, `CMP-002`           | schedule, zone, type, delivery, moved/cancelled/tombstone                                      |
| `CMP-009` Place snapshot            | `PRIM-CARD`, `CMP-002`                   | candidate, snapshot, enrichment, provider error, manual, offline stale                         |
| `CMP-010` Field and validation      | `PRIM-TEXT-FIELD`                        | pristine, focused, local/server invalid, saving, queued, conflict, read-only                   |
| `CMP-011` Feed entry                | `PRIM-FEED-UPDATE-ROW`, `CMP-002`        | authored/system, queued/uploading, revised, reacted, moderated, target unavailable             |
| `CMP-012` Attachment tile           | `PRIM-CARD`, `CMP-002`                   | local preview through rejection/removal; caption or decorative state                           |
| `CMP-013` Reaction control          | `PRIM-ICON-BUTTON`, `CMP-002`            | absent, local queued, synced, rejected, read-only                                              |
| `CMP-014` Decision panel            | `PRIM-CARD`, radio option set, `CMP-002` | draft/open/selected/queued/confirmed/closed/conflict/viewer                                    |
| `CMP-015` Golf hole row             | `PRIM-TEXT-FIELD`, `CMP-002`             | untouched, valid, invalid, queued, synced, conflict, read-only                                 |
| `CMP-016` Role/permission label     | `PRIM-STATUS-CHIP`                       | owner, organizer, participant, viewer, removed, left                                           |
| `CMP-017` Conflict field            | paired `PRIM-CARD` + choice control      | unchanged/local/server/both/tombstoned/concealed                                               |
| `CMP-018` Empty/error recovery      | `PRIM-CARD`, `PRIM-BUTTON`               | permitted empty, read-only empty, retryable, terminal safe unavailable                         |
| `CMP-019` Snapshot progress         | progress indicator + `CMP-002`           | preparing, page progress, paused, resuming, verifying, swapping, complete, storage error       |
| `CMP-020` Recap source/privacy item | `PRIM-CARD`, `CMP-002`                   | linked/generated/manual/consent missing/source removed/included/excluded                       |

The authoritative behavioral details are in the
[critical component-state matrix](../figma-screen-inventory.md#critical-reusable-component-state-matrix).

## Component naming and properties

Name every main component
`Component/<ID>/<variant>/<state>`. Use boolean properties for optional anatomy
and variant properties for mutually exclusive states. Examples:

- `Component/PRIM-BUTTON/Brand/Loading`
- `Component/PRIM-TEXT-FIELD/Default/Focused-Error`
- `Component/PRIM-FEED-UPDATE-ROW/Interactive/Unread`
- `Component/CMP-014/Participant/Closed-Attention`

Expose content through named text properties (`Label`, `Help`, `Error`,
`Timestamp`, `Status`) and assets through instance-swap properties (`Icon`,
`Avatar`, `Trailing`). Do not detach an instance to show an error, role, or
delivery state.

## Interaction and accessibility contract

- Minimum interactive target: 48 x 48 points/dp. A visually smaller icon sits
  inside that target.
- Every icon-only control has a non-visual accessible name annotation.
- Pressed, selected, invalid, unread, queued, conflict, and permission states
  include text or semantics in addition to visual styling.
- Focus remains visible. Validation and async errors move focus to the first
  invalid field or the state heading named by the inventory.
- Use reading order: heading, role/status, content, primary action. Decorative
  logo and icon instances are hidden when adjacent text already names them.
- Disabled state explains why only when the control must remain visible.
  Viewer write controls are normally absent, not disabled upsells.
- At 200% text, components grow vertically. Do not truncate titles, status,
  field errors, or primary actions.
- Prototype gestures always have a named control alternative.
