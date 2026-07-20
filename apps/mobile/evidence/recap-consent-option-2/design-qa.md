# Recap external consent — Design-2 visual QA

- Date: 2026-07-20
- Binding visual direction: `../event-hub-option-2/reference-390x844.png`
- Production surface: `apps/mobile/src/screens/RecapView.tsx`
- Viewport: exact iPhone 16e, 390 x 844 points (1170 x 2532 raw pixels)
- Result: passed; P0 none, P1 none, P2 none

## Combined source comparison

The binding source and the manager, author, participant, viewer and offline
captures were inspected together in one same-viewport comparison input. The
Recap is a sibling screen rather than a pixel clone of the Event Hub, so the
acceptance check is the shared Option-2 visual system and hierarchy: lavender
canvas, black ink outlines and shadows, gold selection, mint actions, lavender
moment surfaces, DM Sans, compact overlines, direct language and generous
touch targets.

## State review

1. Manager grant: the exact event body, gold selected chip, current manager
   status and manager-only selection/grant/withdraw controls are readable in a
   single card. The action stack remains inside the bordered surface.
2. Manager withdraw: the feed body keeps author and manager statuses distinct;
   the manager withdrawal cannot be mistaken for the author's current grant.
3. Feed author: the participant-author gets author grant/withdraw actions on
   the feed body, while the event body exposes manager status only and no
   author action.
4. Non-author participant and viewer: both roles can read the same current
   statuses, but neither capture exposes selection, share or decision controls.
   Their top chips remain explicitly different: `TEILNEHMEND` and
   `NUR ANSEHEN`.
5. Offline drift: stale consent is not styled as current. The yellow warning,
   `Keine Änderung bestätigt`, unknown status, and `Online prüfen` recovery
   are visible without relying on color alone. Mutation controls are absent.

## UX and copy verdict

`EXAKTE TEXTVORSCHAU` explains the scope before the quoted body. Each required
authority is named and uses one of three unambiguous server-current phrases:
`aktuell bestätigt`, `widerrufen`, or `nicht bestätigt`. Capability and role
remain separate: a readable status never implies permission to act. The
offline copy states that no change was confirmed and gives one recovery path.

## Evidence limits

Screenshots establish visual hierarchy, visible authority separation, action
presence or absence, recovery copy, viewport fit and reachable scroll states.
They do not prove live service authorization, refetch semantics, account/root
or version drift, persistence behavior, VoiceOver traversal, or deployment.
Those behaviors remain covered by focused unit/controller tests and source
inspection; this harness intentionally contains fixed visual models only.
