# Team Feed Android IME ReleaseEvidence

Date: 2026-07-20  
Bead: `crew-paq.8.2.2.3`  
Result: PASS for the Android `font_scale=2.0` composer/IME clipping regression.

## Scope

The shared `ScreenFrame` now wraps its existing scroll view in an Android-only
`KeyboardAvoidingView` using `behavior="padding"`. Android `adjustResize` and the
existing iOS `automaticallyAdjustKeyboardInsets` behavior remain in place. The
fix adds no timer, imperative ref, hard-coded keyboard offset, or dependency.

The proof uses the production Event Hub -> Feed -> Team Feed route with a
service-backed isolated fixture. It is not a production deployment or a claim
about live customer data.

## Native acceptance matrix

| Check                               | Native result                                                                                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal font (`font_scale=1.0`)      | Composer, submit control, and first message are visible with no layout regression.                                                                                                                          |
| Large font + IME (`font_scale=2.0`) | Focused multiline input ends at Y=1517 and the visible IME starts at Y=1517: zero-pixel overlap. Its full bottom border is visible.                                                                         |
| Submit reachability                 | After dismissing the IME, semantic scrolling exposes the enabled submit control at `[92,1708][988,1882]` (341.3 x 66.3 dp).                                                                                 |
| TalkBack regression                 | TalkBack is bound with touch exploration enabled; native focus is visibly on the composer. The hierarchy exposes the relevant order as composer, submit, one combined message-body stop, refresh, and back. |

The TalkBack capture proves real service state, composer focus, and native
hierarchy/order. This run does not claim a newly recorded spoken announcement
or a successful injected TalkBack gesture on the message; those broader checks
remain outside this P1 IME-clipping bead.

## Build boundary

The APK was assembled from a fresh Hermes bundle with the `ReleaseEvidence`
variant (`versionName=1.0.20260720`, `versionCode=20260720`) and verified with
APK Signature Scheme v2/v3. It is locally debug-signed for isolated acceptance
only and is not a store/distribution artifact.

Device: isolated Android API 36 emulator, 1080 x 2400, density 420. The existing
developer emulator and Metro listeners were not used or mutated.

## Artifacts

- `01-*`: normal-font production-route capture and hierarchy.
- `02-*`: focused composer at 200% font scale with the IME visible.
- `03-*`: submit control reachable after IME dismissal.
- `04-*`: TalkBack service/focus-order regression capture and hierarchy.
- `focus-composer.yaml` and `dismiss-and-reach-submit.yaml`: semantic native
  automation used for the two IME checks.
- `MEASUREMENTS.md`: measured Android window and accessibility bounds.
- `SOURCE_HASHES.md`: exact source, bundle, and APK provenance.
- `manifest.sha256`: integrity manifest for this evidence directory.

No commit, push, deployment, or production mutation was performed.
