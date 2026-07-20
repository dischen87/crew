# Design QA — Event creation Option 2

> **Historical record, not current acceptance.** The asset manifest was rebound
> after the functional Release-crypto proof so file integrity is current. That
> does not refresh the historical `00`–`07` visual judgment below. Fresh normal
> and Large-Text implementation captures plus a new combined source comparison
> are still required before the current Event Creation surface can pass.

## Binding source and comparison

- Original generated source:
  `/Users/mathias/.codex/generated_images/019f7401-fc84-75a2-86e0-4ce8c012c531/exec-87852388-1a84-4ce9-8504-d886cd44007e.png`
- Normalized binding source:
  `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Historical implementation capture:
  `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-creation-option-2/03-created-event-landing-390x844.png`
- Combined comparison:
  `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-creation-option-2/design-comparison-source-vs-implementation-780x894.png`
- Viewport: both source and implementation panels are exact, uncropped 390 ×
  844 images. The 50-pixel comparison header is outside both viewports.

The source is a populated, published Turkey golf event. The implementation is
the deliberately empty private draft returned by this milestone's real create
flow. The comparison header names those different data/lifecycle states. It is
used to judge the shared Option-2 visual system rather than claim same-state
pixel parity.

## Visual verdict

The private-draft landing preserves the binding Crew Board language:

- the same pale lavender field and compact yellow CREW identity;
- heavy dark outlines, offset card shadows, and deliberately compact radii;
- purple secondary copy, yellow status emphasis, and mint primary action;
- bold event-first hierarchy and an outlined four-item bottom navigator;
- one unambiguous next-action card rather than competing primary controls.

The new creation steps extend that system with the same tokens and existing
primitives. Template cards use color to distinguish setup shape without making
color the only selection signal. The details editor keeps title, description,
time zone, and the single action in a predictable vertical reading order.

## State-by-state review

- `00`: no misleading create control appears outside the eligible private-ready
  model; empty state and create action have distinct hierarchy.
- `01`: the first two options are fully visible and the third begins below the
  fold as a conventional vertical-scroll affordance. Selection uses radio
  semantics and explicit names.
- `02a`: title and description retain entered Unicode text; labels and help
  copy stay attached to their controls.
- `02b`: this is intentionally scrolled. Time zone and both actions fit inside
  the outlined container; the mint submit remains the only primary action.
- `03`: successful creation lands on the returned root, visibly labels
  `Privater Entwurf`, explains the empty plan, and offers exactly one
  `Event prüfen` action.
- `04`: a template outage does not present stale suggestions as current. Blank
  creation remains available and `Setups erneut laden` is explicit.
- `05`: root-list failure makes `Erneut versuchen` the mint primary action;
  create remains a secondary surface action.
- `06a`: Accessibility Large natural top shows uncapped type, intact horizontal
  margins, and a readable step container.
- `06b`: Accessibility Large is intentionally scrolled to the actions. Long
  German labels wrap inside their borders and both controls remain reachable;
  no horizontal content is clipped.
- `07`: the system notice states that the event is visible only to organizers,
  has no plan items, and cannot be published from this view. It does not fake a
  readiness or publish screen.

## Accessibility and interaction checks

- iOS Accessibility Large was applied through the simulator and restored after
  capture.
- No relevant `Text` or `TextInput` uses a fixed font-size cap or fixed text
  line count.
- Buttons retain at least the shared 48-point touch target and labels can shrink
  and wrap within their bordered control.
- Selection uses radio role/state; errors and retry states expose live-region
  semantics; loading/disabled state prevents duplicate submit.
- Screen state changes remount the frame so the scroll view returns to its
  natural top instead of carrying an unrelated prior offset.
- Owner/organizer draft behavior and viewer/published absence of write controls
  are covered separately in functional tests.

## Findings and disposition

- P0: none remaining in this milestone.
- P1: no remaining creation or private-draft landing defect. A real
  participant-faithful `SCR-013` readiness/publish route is explicitly outside
  this milestone and owned by `crew-paq.3.5.4.2`.
- P2: none remaining. The earlier ambiguous large-text image was replaced by a
  named natural-top plus intentionally-scrolled pair. The earlier incorrect
  source-to-old-implementation comparison and false details captures were
  removed.

## QA checklist

- [x] Option 2 / Crew Board is the only implemented direction.
- [x] Reference and current implementation are visible in one comparison.
- [x] Both comparison viewports are 390 × 844 and uncropped.
- [x] Source and draft lifecycle differences are stated on the artifact.
- [x] Main create controls work in the production navigator.
- [x] Empty, loading, template outage, root-list error, success, and draft
      review boundaries are represented truthfully.
- [x] Accessibility Large has paired top and action-reachable scroll evidence.
- [x] No screenshot fixture or service-direct write exists in production code.
- [x] Full publish is not claimed by this evidence set.
- [ ] Regenerate source-current captures and repeat the combined visual gate.

current result: open; historical pass superseded by manifest drift
