# Android feedback responsive QA

## Outcome

The captured Option 2 feedback surfaces pass this Android visual and semantic
gate after two focused fixes. The result is evidence-only: it does not close the
service, database, offline replay, real native capture, account-switch or
multi-device acceptance still listed in the associated Beads.

Visual health for the final captured states: P0 0, P1 0, P2 0. The initial
same-state diagnostics captures retained here contain the corrected P2 and are
not final acceptance images.

## Same-state correction

The single combined input
[`03-diagnostics-before-after-normal-combined-824x915.png`](feedback-compose/comparison/logical/03-diagnostics-before-after-normal-combined-824x915.png)
uses two matching 412x915 Android captures:

- Left: the diagnostics label breaks mid-word as `Kontext-Katego` / `rie`, and
  the evidence harness leaves light status icons on the pale canvas.
- Right: the complete label is stable, the value wraps only at its word
  boundary and the runner uses the production app's `dark-content` status-bar
  treatment.

At real `font_scale=2.0`, the former two-column row squeezed both label and
value into narrow columns. The final view uses the existing responsive product
pattern: label and value stack vertically at `fontScale >= 2`. It adds no font
cap, ellipsis, hidden copy or fixed line count. At normal text, the label keeps
its intrinsic width while the value uses the remaining width.

## Captured checks

| Surface              | Final evidence                                 | Result                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnostics consent  | OFF and ON at 1.0 and 2.0                      | Checkbox defaults OFF, semantic tap changes it to ON, and the bounded preview remains readable.                                                                                                                          |
| Diagnostics preview  | App version, build, platform, context category | Accessibility label contains exactly the four displayed fields; no device identifier, event ID, logs or invitation code.                                                                                                 |
| Screenshot consent   | Preview plus OFF and ON at 1.0 and 2.0         | Separate screenshot consent is visible and check state changes semantically. This does not prove native capture or persistence.                                                                                          |
| Duplicate suggestion | Cached suggestion at 1.0 and 2.0               | Sanitized title, status and vote count remain readable and actionable. This does not prove API/DB deduplication.                                                                                                         |
| Community source     | Ready at 1.0 and 2.0                           | Text-feedback and screenshot entry actions remain visible.                                                                                                                                                               |
| Capture recovery     | Failure and busy at 1.0                        | Failure preserves the text route; busy marks the screenshot action disabled and busy. This is a pure-view state, not a native capture run.                                                                               |
| Editing focus        | Title at 1.0                                   | UIAutomator reports `focused=true`, `content-desc="Feedback-Titel"`; Android reports the IME input view shown. The emulator uses its physical-keyboard edit toolbar, so no full on-screen-keyboard layout claim is made. |

## Semantic measurements

Density 420 converts physical pixels to dp with `px * 160 / 420`.

- Diagnostics consent, normal: 796x268 px, approximately 303x102 dp,
  `checked=false` and `checked=true` captures retained.
- Diagnostics consent, 2.0: 796x554/559 px, approximately 303x211/213 dp.
- Screenshot consent, normal: 796x331/336 px, approximately 303x126/128 dp.
- Screenshot consent, 2.0: 796x743/749 px, approximately 303x283/285 dp.
- Duplicate suggestion, normal: 796x205 px, approximately 303x78 dp.
- Duplicate suggestion, 2.0: 796x459 px, approximately 303x175 dp.
- Community actions, normal: 996x142 px, approximately 379x54 dp.
- Focused title field: 898x126 px, approximately 342x48 dp.

These bounds clear the 48 dp target for the controls checked in this run. The
hierarchies also retain explicit checkbox/button roles, labels, enabled/busy,
checked and focused state. This is not a spoken TalkBack-output test and is not
a claim of full WCAG conformance.

## Build and source provenance

- Unsigned Release APK SHA-256:
  `62bba916066db77bc7974739b2c5da4d2c6eca28ab557fe8fd523cced329344b`.
- Emulator-only debug-signed APK SHA-256:
  `4f92c5b25653e781525bf2d8aad44091439bc35dcd916b7019fe55a27d6cdc78`.
- Debug signer certificate SHA-256:
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Final `FeedbackComposeView.tsx` SHA-256:
  `0be182e67449af123c69d5f2bffb54a7456b587d285adbe67a1f55b401d39098`.
- Final Android runner SHA-256:
  `e2895e47cb740d538c75b1ba05f84ea35b2774b1a1ba32d9e23ede88cf9292f4`.
- Maximum observed Android build-tree growth over the preserved preflight was
  1,379,676 KiB (about 1.316 GiB), below the 1.5 GiB gate.

The APK uses no release key and makes no deployment claim.

## Verification

- `FeedbackComposeView.test.tsx` and `Option2EvidenceEntries.test.js`: 21/21
  focused tests passed.
- Mobile TypeScript: final frozen-tree `tsc --noEmit` passed after the
  concurrently generated recap client finished regenerating.
- Focused ESLint: passed.
- Prettier check for changed source, tests and Maestro flows: passed.
- Android Release build: 377/377 tasks executed, `BUILD SUCCESSFUL`.
- Every retained final screenshot was opened and visually inspected in this
  run. The normal diagnostics before/final images were also opened together as
  the combined same-state input above.

## Acceptance boundary

This run supports `crew-paq.6.2.4` for Android diagnostics UI/semantics and
adds narrow UI evidence to `crew-paq.6.2.2` and `crew-paq.6.2.3`. All three
Beads remain open because their API, database, offline/restart, real native
capture, authorization and device-matrix conditions are not completed here.

## Emulator restoration

The shared emulator was returned to its exact preflight app boundary after the
evidence run:

- Installed Debug APK SHA-256 equals the preserved original:
  `a69cd7520f860be011991320564502885cb0e81c17ba7c668408f7ff7de2dfa8`.
- All 16 preserved durable files compare byte-for-byte with the preflight
  snapshot. The Debug relaunch refreshed only its dev bundle and profile marker;
  those two files were restored from the protected snapshot while the app
  remained on the observed signed-out screen.
- UIAutomator again reports `private-access-signed-out`, `Bitte anmelden` and
  `Mit E-Mail anmelden`.
- `font_scale=1.0`, physical size 1080x2400, density 420, accessibility service
  `null`, accessibility enabled `0`, and hardware-keyboard IME preference `0`.
- ADB reverse remains exactly 8082 to 8082 and 3000 to 3000.
- Existing host listeners were preserved: PID 45252 on 8081 and PID 70661 on 8082. Ports 3000, 3101, 5433 and 6380 remain without listeners.
