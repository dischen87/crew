# Option 2 foundations

The values in this file are a direct Figma translation of
[theme.ts](../../../apps/mobile/src/design/theme.ts) and the accepted 390 x 844
Event Hub implementation. Create Figma variables with the names below; do not
eyedrop colors, infer dimensions from a scaled screenshot, or blend another
visual option into this system.

## Artboards and safe areas

| ID          |        Frame | Safe area                  |  Usable content frame | Use                                                            |
| ----------- | -----------: | -------------------------- | --------------------: | -------------------------------------------------------------- |
| `A-IOS-390` | 390 x 844 pt | 47 top, 34 bottom, 0 sides | 390 x 763 at `(0,47)` | Exact iPhone 16e evidence reconstruction and comparison        |
| `A-IOS`     | 393 x 852 pt | 59 top, 34 bottom, 0 sides | 393 x 759 at `(0,59)` | Required current iOS production artboard                       |
| `A-AND`     | 412 x 915 dp | 24 top, 24 bottom, 0 sides | 412 x 867 at `(0,24)` | Required current Android production artboard                   |
| `A-COMPACT` | 375 x 667 pt | 20 top, 0 bottom, 0 sides  | 375 x 647 at `(0,20)` | 200% text, clipping, focus, and action-reachability check only |

`A-IOS-390` matches the persistent captures and the test metrics
`{top:47,bottom:34,left:0,right:0}`. It does not replace `A-IOS` or `A-AND`.

- Draw safe areas as non-exporting guides named `Guide/Safe/Top` and
  `Guide/Safe/Bottom`.
- Keep the status bar, home/gesture area, keyboard, date/time picker, media
  picker, and share sheet platform-native. Add a linked annotation instead of
  recreating one.
- Scrolling content starts below the top inset exactly once. Do not combine
  manual top padding with automatic platform content adjustment.
- A fixed action dock or bottom navigation owns the bottom inset. Scrolling
  content must remain reachable above it.
- Use a four-point base grid. Every tokenized space is a multiple of two; use
  the named spacing variables rather than local Figma values.

## Color variables

### Source palette

| Figma variable           | Code token              | Value     |
| ------------------------ | ----------------------- | --------- |
| `palette/canvas`         | `palette.canvas`        | `#F0DDF5` |
| `palette/canvas-pressed` | `palette.canvasPressed` | `#E8D3F0` |
| `palette/paper`          | `palette.paper`         | `#FFFFFF` |
| `palette/ink`            | `palette.ink`           | `#2D2D2D` |
| `palette/gold`           | `palette.gold`          | `#F5D565` |
| `palette/gold-pressed`   | `palette.goldPressed`   | `#EBC94E` |
| `palette/mint`           | `palette.mint`          | `#C2E8D5` |
| `palette/mint-pressed`   | `palette.mintPressed`   | `#A3D4BE` |
| `palette/lavender`       | `palette.lavender`      | `#D5C2E8` |
| `palette/purple`         | `palette.purple`        | `#5A487F` |
| `palette/danger`         | `palette.danger`        | `#8B1E3F` |
| `palette/divider`        | `palette.divider`       | `#A99EAE` |

### Semantic aliases

| Figma variable                 | Alias                    | Required use                            |
| ------------------------------ | ------------------------ | --------------------------------------- |
| `color/background`             | `palette/canvas`         | Screen and fixed-dock background        |
| `color/background-pressed`     | `palette/canvas-pressed` | Pressed row/date state                  |
| `color/surface`                | `palette/paper`          | Neutral cards and inputs                |
| `color/surface-brand`          | `palette/gold`           | Primary Option 2 emphasis               |
| `color/surface-brand-pressed`  | `palette/gold-pressed`   | Pressed brand control                   |
| `color/surface-action`         | `palette/mint`           | Positive/action surface                 |
| `color/surface-action-pressed` | `palette/mint-pressed`   | Pressed action control                  |
| `color/surface-accent`         | `palette/lavender`       | Secondary selected/update surface       |
| `color/text`                   | `palette/ink`            | Default text and strong border          |
| `color/text-secondary`         | `palette/purple`         | Metadata, captions, focus-adjacent text |
| `color/text-inverse`           | `palette/paper`          | Text on `color/text` only               |
| `color/border`                 | `palette/ink`            | Neo-brutalist outlines and hard shadows |
| `color/divider`                | `palette/divider`        | Decorative or grouping dividers         |
| `color/error`                  | `palette/danger`         | Error text and invalid border           |
| `color/focus`                  | `palette/purple`         | Visible focus and selected outline      |

`color/text` and `color/text-secondary` meet normal-text AA on their approved
surfaces. `color/error` is at least 4.5:1 on background and surface;
`color/focus` is at least 3:1 on both. Error, focus, selection, delivery, and
permission states also require text or semantics; color is never the only cue.

## Text styles

All styles use the embedded variable family **DM Sans**. Figma should load the
same local font binary recorded in [Evidence and provenance](./04-evidence-and-provenance.md).

| Figma style        | Size / line | Weight | Tracking | Extra                     |
| ------------------ | ----------: | -----: | -------: | ------------------------- |
| `type/display`     |     40 / 44 |    800 |     -1.2 | Main event title only     |
| `type/title`       |     32 / 36 |    800 |     -0.8 | Screen/card title         |
| `type/heading`     |     24 / 28 |    800 |     -0.4 | Section heading           |
| `type/subheading`  |     20 / 24 |    800 |     -0.2 | Row/card subheading       |
| `type/body`        |     17 / 24 |    400 |        0 | Default reading text      |
| `type/body-strong` |     17 / 24 |    700 |        0 | Control and row label     |
| `type/label`       |     14 / 18 |    700 |        0 | Compact label             |
| `type/caption`     |     12 / 16 |    600 |        0 | Metadata and support copy |
| `type/overline`    |     11 / 14 |    700 |      1.2 | Uppercase                 |
| `type/numeric`     |     28 / 32 |    800 |        0 | Tabular numerals          |

Do not convert text to outlines. Enable text wrapping and vertical growth. At
200% platform text, reading order and reachability matter more than matching a
fixed screenshot height.

## Spacing, radius, and border variables

| Family  | Variables                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacing | `space/none=0`, `space/xxs=2`, `space/xs=4`, `space/sm=8`, `space/md=12`, `space/lg=16`, `space/xl=24`, `space/xxl=32`, `space/xxxl=40`, `space/jumbo=48` |
| Radius  | `radius/compact=12`, `radius/control=14`, `radius/card=20`, `radius/navigation=20`, `radius/pill=999`                                                     |
| Border  | `border/subtle=1`, `border/chip=2`, `border/strong=3`                                                                                                     |

Structural values such as flex growth or full width are not visual tokens.
Every visible padding, gap, radius, outline, and minimum target uses a variable
unless an accepted evidence exception appears below.

## Effects and motion

All shadows are hard, use `color/border`, opacity 100%, and blur 0.

| Figma effect     |   Offset | Matching runtime elevation |
| ---------------- | -------: | -------------------------: |
| `effect/compact` | 2 x, 2 y |                          2 |
| `effect/control` | 3 x, 3 y |                          3 |
| `effect/card`    | 4 x, 4 y |                          4 |
| `effect/pressed` | 1 x, 1 y |                          1 |

| Motion variable            |                 Value | Use                                       |
| -------------------------- | --------------------: | ----------------------------------------- |
| `motion/reduced`           |                  0 ms | Reduced-motion substitution               |
| `motion/press`             |                100 ms | Press feedback                            |
| `motion/control`           |                150 ms | Control state change                      |
| `motion/focus`             |                200 ms | Focus transition                          |
| `motion/entrance`          |                500 ms | Optional bounded entrance only            |
| `motion/easing-expressive` | `0.16, 0.84, 0.44, 1` | Option 2 expressive transition            |
| `motion/control-offset`    |              2 x, 2 y | Pressed control translation               |
| `motion/card-scale`        |                  0.98 | Pressed card only when it remains legible |

Never use motion as the sole status cue. All prototype transitions fall back to
an instant change under reduced motion.

## Component metrics

| Variable                            | Value |
| ----------------------------------- | ----: |
| `metric/control/min-touch`          |    48 |
| `metric/control/disabled-opacity`   |  0.42 |
| `metric/navigation/min-item-height` |    56 |
| `metric/status/chip-min-height`     |    28 |
| `metric/status/indicator-size`      |    28 |
| `metric/avatar/size`                |    40 |
| `metric/avatar/overlap`             |    10 |
| `metric/avatar/max-visible`         |     7 |
| `metric/timeline/min-row-height`    |    72 |
| `metric/timeline/icon-size`         |    40 |
| `metric/timeline/time-column`       |    68 |

## Accepted 390 x 844 Event Hub layout

These measurements reproduce the accepted evidence frame. Values marked
`evidence exception` are screen-density choices, not new global variables.

| ID                 | Measurement                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `LAY-EH-CANVAS`    | 390 x 844; background image at cover; safe top 47, safe bottom 34                                                       |
| `LAY-EH-CONTENT`   | 16 left/right padding; 358-point content width; scrolling region above fixed navigation                                 |
| `LAY-EH-BRAND`     | 52 x 52 logo; 12 gap to `CREW`; sync icon control 48 x 48                                                               |
| `LAY-EH-TITLE`     | `type/display`; 16 top margin after brand row                                                                           |
| `LAY-EH-DATE`      | Six equal-width cells; 4 gap; 58 minimum height; selected/today has 2 border                                            |
| `LAY-EH-HERO`      | 358 available width; 158 minimum height; 20 radius; 3 border; 4 hard shadow; 10 inner padding (`evidence exception`)    |
| `LAY-EH-HERO-TIME` | 88-point time column; 2 divider; 8 inner column gap                                                                     |
| `LAY-EH-TIMELINE`  | 8-point negative horizontal expansion from content; 54 minimum row, 36 icon, 60 time column (`evidence exception`)      |
| `LAY-EH-FEED`      | 8 inner padding; 36 avatar; 8 gap; lavender card; appears below fold in unscrolled evidence                             |
| `LAY-EH-NAV`       | Fixed; 12 left/right margin; 20 top radii; 3 border; each item at least 56 high; bottom padding is `max(safe-bottom,8)` |

The short-scroll feed evidence intentionally clips the brand area; it proves
the feed row and fixed navigation, not an alternative initial scroll position.

## Team screen layout contract

The Team assignment and decision surfaces reuse Option 2 foundations instead
of creating a second system.

| ID                  | Measurement                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `LAY-TEAM-CONTENT`  | 16 left/right; 12 vertical stack gap; 24 bottom content padding                     |
| `LAY-TEAM-BRAND`    | 44 x 44 logo plus 48 x 48 named back control                                        |
| `LAY-TEAM-DOCK`     | Fixed background; 2 top border; 16 left/right; 12 top; bottom `max(safe-bottom,12)` |
| `LAY-TEAM-MEMBER`   | 52 minimum row; 14 radius; 2 border; 8 horizontal gap                               |
| `LAY-TEAM-OPTION`   | 66 minimum row; 20 radius; 3 border; 16 horizontal and 12 vertical padding          |
| `LAY-TEAM-SELECTED` | Mint surface plus a 40 x 40 gold/check indicator; selection is also announced       |

The persistent Team screenshots linked in
[Evidence and provenance](./04-evidence-and-provenance.md) confirm these
source-backed values for the two named iOS fixtures only.
