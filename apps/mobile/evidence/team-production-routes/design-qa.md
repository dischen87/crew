# Production Team routes Option 2 QA

> **Historical record, not current acceptance.** These captures compare the
> Event Hub reference with different Team setup/decision/draft states and
> predate the current `TeamProductionRuntime` and Event Hub changes. They remain
> useful interaction provenance, but fresh source-current normal/Large-Text
> captures and same-state comparisons are required for current visual approval.

- Selected visual source: `../event-hub-option-2/reference-390x844.png`
- Team setup: `01-team-setup-production-390x844.png`
- Decision: `02-decision-production-390x844.png`
- In-memory assignment draft: `03-team-draft-production-390x844.png`
- Same-input review: `comparison-reference-vs-production-team.png` (binding
  source, setup, Decision, draft; all 390 x 844)
- Viewport: iPhone 16e, 390 x 844 points; native captures retained at
  1170 x 2532 pixels.
- Runtime: production SQLCipher migrations, mobile-data read models,
  `MemberDirectoryStore`, `TeamProductionRuntime`, and production views.

## Visual review

- P0: none.
- P1: none.
- P2: none. Both screens render without horizontal clipping or obscured
  interactive content at the exact target viewport.
- The Option 2 language stays coherent with the Event Hub: lavender paper
  canvas, gold action/question surface, mint secondary surface, three-point
  dark outlines, hard shadows, DM Sans hierarchy, Crew lockup, and icon-only
  controls with accessible labels.
- A deliberately absent directory name renders as `Teilnehmende Person 3`.
  The two-line wrap is legible and keeps the stable user ID completely hidden.
- The synced assignment state exposes no misleading publish action. The open
  decision begins with no selected option and therefore correctly disables
  `Antwort senden`.
- Moving Lena changes the status to `Änderungen offen · noch nicht
veröffentlicht` and exposes the publish CTA. It never claims crash-safe local
  persistence before the outbox write.

## Interaction and accessibility proof

- Maestro launched the app on the iPhone 16e, asserted `Teams einteilen`,
  exercised the stable-ID move control, asserted the honest draft status and
  publish CTA, activated the accessible `Zurück` control, and asserted the
  production Decision heading.
- Every person move action has a visible destination and an accessibility label;
  missing names use the same neutral label in visual and accessibility output.
- Lifecycle and delivery state are written in text and iconography, not color
  alone.
- Jest covers exact route scoping, manager/participant/viewer guards, offline
  reads, directory fallback, outbox writes, restart, account switching, denial
  purge, and re-invite behavior.

## Platform boundary

- iOS: rendered and accessibility-driven on the exact target simulator.
- Android: static configuration and shared React Native/Jest coverage only;
  Android runtime evidence remains unclaimed because no Android toolchain or
  device was available for this run.

current result: open; historical cross-state comparison only
