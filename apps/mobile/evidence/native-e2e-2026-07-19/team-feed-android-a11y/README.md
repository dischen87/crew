# Android Team Feed accessibility gate

Date: 2026-07-19  
Device: `emulator-5554`, Android logical viewport 412 × 915  
Bead: `crew-paq.8.2.2`  
Result: **blocked safely; keep open**

## Audit scope

The requested route is the real production Team Event Hub → Team Feed path on
Android. The target evidence includes 2.0 font scale with scrolling, keyboard
and focus behavior, touch targets, TalkBack focus order and labels, and live
delivery-state announcements.

## Current-run evidence

1. **Original Debug signed-out boundary — healthy.** The fresh device capture
   shows the private gate and no event or account data. The accepted normalized
   screenshot is
   [`01-current-debug-signed-out-412x915.png`](./01-current-debug-signed-out-412x915.png);
   the untouched physical capture is
   [`01-current-debug-signed-out-1080x2400.png`](./01-current-debug-signed-out-1080x2400.png).
2. **Accessibility capability preflight — available but not exercised.** The
   preinstalled `com.google.android.marvin.talkback` package is version
   `16.0.0.738667889` and exposes `.TalkBackService`. Accessibility was disabled
   before the run (`enabled_accessibility_services=null`,
   `accessibility_enabled=0`) and was not changed because the target route was
   unreachable.
3. **Production Team Feed entry — blocked.** The prior two-user matrix ended
   with real-UI logout on both devices and then removed the exact isolated Team
   runtime. In this fresh run the app is signed out, that runtime path is absent,
   and ports `3000`, `3101`, `5433`, and `6380` are closed. Reaching Team Feed
   would therefore require restarting backend state or authenticating again;
   both were outside this Android-only evidence scope.

The sanitized current-run UI hierarchy is
[`01-current-debug-signed-out-ui.xml`](./01-current-debug-signed-out-ui.xml). It
contains no URL, bearer, token-shaped query, or email address.

## Verification gaps

No claim is made for the Team Feed's Android 2.0-font reflow, scrolled layout,
software keyboard, focus retention, touch-target size, TalkBack traversal,
labels, or live-region announcements. Historical Team Feed screenshots from the
completed native matrix were deliberately not reused as current accessibility
evidence.

## Preserved device boundary

| Boundary                 | Before and after this run                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| Installed app            | Original Debug APK, SHA-256 `a69cd7520f860be011991320564502885cb0e81c17ba7c668408f7ff7de2dfa8` |
| App state                | Signed out; protected event and account content concealed                                      |
| Durable app-data digest  | `6f23e0518fbc5f5b7e105645f1e2ac41f463fc29ea44827c37f8d8cf793af936`                             |
| Display                  | Physical 1080 × 2400, density 420, `font_scale=1.0`                                            |
| Android reverse mappings | Only `tcp:8082 → tcp:8082` and `tcp:3000 → tcp:3000`                                           |
| Accessibility settings   | TalkBack remains disabled; no service setting changed                                          |
| Host listeners           | `8081` PID 45252 and `8082` PID 70661 unchanged; Team service ports remain closed              |

The device UI was read only. No app install, uninstall, data clear, account
change, font-scale change, density change, reverse-map change, source edit,
backend write, commit, push, or deploy occurred. A temporary UI-dump file on
shared emulator storage was removed immediately after its sanitized copy was
verified.

## Asset hashes

| Asset                                       | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `01-current-debug-signed-out-1080x2400.png` | `1ceec52e21d23eb9f715c696bb42faef4666d92e5024cc14ce6d9302eab65ebd` |
| `01-current-debug-signed-out-412x915.png`   | `dcdcee00345ff692b7e63d9f57ad8849d0a64cbf6fc97a06b160b366c0969b5a` |
| `01-current-debug-signed-out-ui.xml`        | `36389f2a71758457f9a556a61fba71a59a5b4829da4067613284651be5ee2f28` |

`crew-paq.8.2.2` must remain open until a fresh, safely authenticated Team
fixture is available and the missing Android checks above are captured on the
real production route.
