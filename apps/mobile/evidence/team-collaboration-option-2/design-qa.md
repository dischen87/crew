# Team collaboration Option 2 design QA

> **Historical record, not current acceptance.** These captures compare the
> Event Hub reference with different Team assignment/decision states rather
> than a same-state implementation, and they predate the current production
> Team feed/runtime changes. The review below remains provenance only; fresh
> source-current normal/Large-Text captures and same-state comparisons are
> required before the current Team collaboration surface passes.

- Source visual truth: `/Users/mathias/.codex/generated_images/019f7401-fc84-75a2-86e0-4ce8c012c531/exec-87852388-1a84-4ce9-8504-d886cd44007e.png`
- Normalized source: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Organizer implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/team-collaboration-option-2/01-organizer-assignments-390x844.png`
- Participant implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/team-collaboration-option-2/02-participant-closed-attention-390x844.png`
- Combined comparison: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/team-collaboration-option-2/comparison-source-vs-team-views.png`
- Viewport: exact 390 x 844 point iPhone 16e simulator captures, persisted at 1170 x 2532 pixels and normalized 1:1 to 390 x 844 for comparison
- States: organizer assignment draft, unpublished local change; participant decision, closed during an outage, local choice retained, needs attention

## Findings

- P0: none.
- P1: none remaining. The first organizer capture paired `Synchronisiert` with a local unpublished edit, which could overstate server confirmation. The final model and capture now say `Nicht veröffentlicht · lokal gespeichert`, use the offline delivery icon, and retain `Einteilung veröffentlichen` as the single write action.
- P2: none remaining. Both screens keep their primary action visible, preserve a scrollable content region, expose at least 48-point controls, and render without horizontal clipping at the persisted viewport.

## Required fidelity surfaces

- Fonts and typography: DM Sans is used through the shared Crew tokens. Heavy headings, compact overlines, body hierarchy, wrapping, and tabular status copy match the selected Crew Board direction.
- Spacing and layout rhythm: 16-point page gutters, rounded 3-point outlined cards, hard shadows, compact metadata, and a fixed single-action dock continue the source rhythm. The back affordance and absent bottom navigation are intentional because these are subordinate task screens rather than the root Event Hub.
- Colors and visual tokens: lavender canvas, gold publish/question surfaces, mint selection, white rows, purple secondary copy, and near-black borders come only from the shared Option 2 tokens.
- Image quality and asset fidelity: the official Crew logo, generated participant portraits, and Phosphor-derived raster icons are sharp at simulator scale. Name-derived initials are used only when a real profile image is absent; there are no emoji, handcrafted SVGs, or generic image placeholders.
- Copy and content: German follows the UX copy matrix and distinguishes unpublished, synced, needs-attention, and closed truth. The closed decision explicitly says the local choice remains visible.

## Accessibility and interaction evidence

- Every member move control announces person, current team, capacity, and the explicit deterministic destination; the same destination is also visible beside the control.
- Decision choices use radio semantics with checked and disabled state; delivery and lifecycle are announced in text, not color alone.
- Viewer runtime guards omit foreign roster data and all write controls. Participant adapters expose only the actor's own assignment and response.
- Focused Jest coverage exercises move, publish, select, submit, viewer read-only, participant privacy, manager outbox adapters, concurrent-tap coalescing, exact-response replay, and closed-during-outage retention.
- The isolated simulator build rendered both final states. Device-level Maestro interaction was attempted but is unavailable on this machine because no Java runtime is installed; the interaction path is covered by focused React Native tests and remains a device-E2E follow-up.

## Comparison history

1. Initial review found one P1 delivery-truth mismatch in the organizer status (`Synchronisiert` plus an unpublished local change).
2. The assignment delivery model gained an explicit `unpublished` state and canonical `Nicht veröffentlicht · lokal gespeichert` copy.
3. The implementation was rebundled, installed on the same 390 x 844 iPhone 16e viewport as the Event Hub evidence, recaptured at 1170 x 2532 pixels, normalized 1:1, and recombined with the selected Option 2 reference and the participant decision capture.
4. At capture time the combined evidence had no actionable P0/P1/P2 finding.
   That historical cross-state result does not establish current same-state
   fidelity after the production runtime changes.

## Implementation checklist

- [x] Selected Option 2 reference used as the visual source.
- [x] Organizer and participant states captured at 390 x 844.
- [x] One primary action per state.
- [x] Delivery/lifecycle truth visible without color alone.
- [x] Real icon and portrait assets used.
- [x] P1 correction recaptured and compared in one combined image.
- [ ] Capture and compare the current implementation in a matching state.

current result: open; historical cross-state comparison only
