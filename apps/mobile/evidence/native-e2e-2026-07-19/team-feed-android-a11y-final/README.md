# Android Team Feed accessibility final gate

Date completed: 2026-07-20  
Route: production Event Hub → Feed → Team Feed (`eventId: null`)  
Device: isolated `emulator-5556`, 1080 × 2400 physical, 420 dpi  
Bead: `crew-paq.8.2.2`  
Result: **partially passed; keep open**

## Accepted source hardening

- A feed body is the single TalkBack target for one entry. Author and timestamp
  remain visually present but are removed from nested accessibility traversal.
- The target has one combined author/body/timestamp label and the named custom
  action `Beitrag kopieren`.
- Copy uses one handler for the custom action and the visible attention-state
  fallback button, copies the body, and announces `Beitrag kopiert.`.
- Each delivery chip has a stable test ID and a short polite live region.
- The summary tells users to use the named copy action rather than an
  undiscoverable long press.

The attempted event-driven keyboard-scroll patch did not meet the native 2.0
font gate and was fully reverted. It is not part of the accepted source.

## Current-run native evidence

1. `01-normal-robust-focus-*` proves the production Team Feed hierarchy has a
   non-focusable entry card, a delivery chip, and exactly one focusable body
   node with its combined label.
2. `02-talkback-single-message-focus-*` shows real TalkBack focus on exactly one
   message. The speech overlay reads the combined author, message, and time;
   there is no duplicate nested body stop.
3. `03-queued-state-talkback-*` shows the locally queued delivery state on the
   real route. Its speech overlay still contains the preceding message, so this
   asset is **not** accepted as proof of the queued live announcement.
4. `04-font-200-top-*` and `05-font-200-bottom-*` prove readable, scrollable
   2.0-font content without fixed-line truncation. Refresh and Back measured
   about 341 × 66 dp, above the minimum touch target.
5. `06-font-200-ime-blocked-*` is the final rejected IME attempt. Android reports
   `mImeWindowVis=3` and `mInputShown=true`; the focused input remains at
   `[92,1246][990,1582]` and is visibly clipped by the keyboard. The submit
   control is hidden. This is blocking evidence, not visual acceptance.

Every normalized screenshot in this folder was inspected in the current run.

## Verification gates

| Gate | Result |
| --- | --- |
| Focused Jest (`TeamFeed` + design primitives) | PASS, 19/19 |
| TypeScript (`tsc --noEmit`) | PASS |
| Scoped ESLint | PASS |
| Scoped Prettier | PASS |
| Single native message focus | PASS |
| 2.0-font scroll and touch targets | PASS |
| 2.0-font composer with IME | **BLOCKED** |
| Native attention fallback button | **OPEN** — controlled attention state was not reached |
| Native custom-action invocation | **OPEN** — shell shortcut could not reliably open the TalkBack action menu; handler is unit-tested |
| Queued live speech transition | **OPEN** — visible state captured, transition speech not captured |

The Jest run emits React Native's known warning that core `Clipboard` is
deprecated. No new dependency was introduced for this scoped hardening; moving
to `@react-native-clipboard/clipboard` remains a separate upgrade.

## Isolation and cleanup proof

- The temporary runner, PostgreSQL, Redis, AVD, emulator, fixture state, bearer
  files, and `/private/tmp/crew-teamfeed-a11y.NEcDf1` were removed.
- Ports 3000, 3103, 6380, and 5434 had no listeners after cleanup.
- Only the original `emulator-5554` remained. It still had `font_scale=1.0`,
  accessibility disabled, services `null`, and the original reverse mappings
  `8082→8082` and `3000→3000`.
- The original app remained `app.crew.next`, size 57,844,202 bytes, SHA-256
  `a69cd7520f860be011991320564502885cb0e81c17ba7c668408f7ff7de2dfa8`.
- Original host listeners remained PID 45252 on 8081 and PID 70661 on 8082.
- No commit, push, deployment, install, uninstall, data clear, or change to the
  original device/session was performed.

See `SOURCE_HASHES.md` for the audited source snapshot and `manifest.sha256`
for evidence integrity. `crew-paq.8.2.2` must remain open until the linked P1
IME follow-up and the remaining native attention/live-announcement checks pass.
