# Frozen bugs 3.12–3.14 — iOS design and accessibility QA

Current result: **accepted on iOS; P0/P1/P2 = 0.**

## Audit scope

- Product surfaces: production Option-2 `EventHubView`, `RecapView`, and
  `UnavailableView`.
- User goal: read and act on Event Hub, Recap and protected-content recovery at
  normal text and Accessibility Large without content entering the iOS status
  bar, losing contrast, repeating guidance or hiding an action.
- Device: exact iPhone 16e, iOS 26.2, light appearance, 390 x 844 points.
- Capture states: eleven source-current top/scrolled screens and six combined
  comparison inputs.
- Review method: native Maestro reachability, simulator screenshots, exact
  panel composites, source/token inspection and focused component tests.

## Step review

1. **Event Hub normal top — healthy.** The live status bar occupies the first
   47 points. The Crew row begins immediately below it, matching the existing
   Option-2 rhythm without a second safe-area gap.
2. **Event Hub normal scrolled — healthy.** The title becomes the first visible
   scrolling content exactly at the viewport boundary. It never paints into the
   status-bar region; the update and fixed navigation remain visible.
3. **Event Hub Accessibility Large top — healthy.** Title, date, location,
   participant and sync hierarchy wrap naturally. The fixed navigation remains
   readable without reducing font scale.
4. **Event Hub Accessibility Large scrolled — healthy.** The prior content is
   clipped at the 47-point viewport boundary. Route, timeline rows, update and
   navigation remain reachable with no horizontal crop.
5. **Recap normal top — healthy.** Brand, title, phase, role, sync and both
   organizer actions start at the expected source-aligned spacing.
6. **Recap normal scrolled — healthy.** Both moments and explicit title-only
   privacy state remain readable. The lavender card uses dark text, and the
   scroll content stops below the live status bar.
7. **Recap Accessibility Large top — healthy.** Display title, metadata and
   actions grow naturally. The lower action may continue below the first frame,
   which the paired scroll state proves is reachable.
8. **Recap Accessibility Large scrolled — healthy.** The lavender Moment 2
   title/body and privacy card are readable without truncation. The preceding
   card is clipped exactly at, not above, the live safe viewport.
9. **Unavailable auth normal — healthy.** Eyebrow, title, action guidance,
   status, privacy consequence and `Zu Events` action are distinct and fit in
   one frame.
10. **Unavailable auth Accessibility Large top — healthy.** The title and
    guidance wrap by words without a restrictive line cap or mid-word split.
11. **Unavailable auth Accessibility Large actions — healthy.** The scroll
    continuation retains guidance context and exposes the complete status,
    privacy consequence and action below the status bar.

## Accessibility and contrast findings

- `EventHubView` and `RecapView` use the existing design-system pattern:
  `marginTop: insets.top` fixes the ScrollView viewport below the live status
  bar, while content padding uses `max(spacing.md - insets.top, 0)`. With the
  measured 47-point inset, residual top padding is zero; with a zero inset,
  normal 12-point content padding remains.
- The current Recap `momentBody` and `momentNumber` use `colors.text`
  `#2D2D2D` on lavender `#D5C2E8`. The source utility measures 8.336:1,
  exceeding the 4.5:1 normal-text threshold.
- Recap phase and role chips, sync labels, icons, moment numbers and the
  `EXTERN: NUR TITEL` label make meaning understandable without color alone.
- Text remains fully scalable. No reviewed title, guidance, moment or action
  uses truncation, `adjustsFontSizeToFit`, or a restrictive maximum multiplier.
- Screenshot evidence does not prove the complete VoiceOver order. Existing
  accessibility labels, roles and focused tests are the non-visual evidence
  for semantics.

## Copy and privacy findings

- Auth status: `ZUGRIFF NICHT VERFÜGBAR`.
- Auth title: `Inhalt nicht verfügbar`.
- Guidance: return to Events and choose an available item.
- Privacy consequence: no detail about the protected target is confirmed.
- Action: `Zu Events`.

The exact title phrase appears once. The screen contains no account, root,
event, token, request, backend error, reason or storage detail. Normal and Large
captures agree with the German source and focused copy assertion.

## Findings and disposition

- P0: none.
- P1: none.
- P2: none.
- No source change was required by the current visual gate.
- Historical panels retain provenance only; all acceptance claims use the
  source-current captures in this folder.

## Acceptance checklist

- [x] 3.12 Event Hub normal top and materially scrolled.
- [x] 3.12 Event Hub Accessibility Large top and materially scrolled.
- [x] 3.12 Recap normal top and materially scrolled.
- [x] 3.12 Recap Accessibility Large top and materially scrolled.
- [x] 3.12 live 47-point safe viewport and no double inset.
- [x] 3.13 lavender moments at normal and Accessibility Large.
- [x] 3.13 existing text token measures at least 4.5:1.
- [x] 3.13 states do not rely on color alone.
- [x] 3.14 unavailable auth at normal and Accessibility Large.
- [x] 3.14 copy jobs are distinct and concealed.
- [x] Exact reference/history/current panels reviewed together.
- [x] No remaining visible P0/P1/P2 issue.
