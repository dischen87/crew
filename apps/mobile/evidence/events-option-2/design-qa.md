# Events switching Option 2 design QA

> **Historical record, not current acceptance.** The current asset manifest has
> 4/14 mismatches. The review below remains useful provenance for the earlier
> frozen source/capture pair, but fresh normal and Large-Text captures plus a
> new combined comparison are required before the current Events surface passes.

- Source visual truth: `/Users/mathias/.codex/generated_images/019f7401-fc84-75a2-86e0-4ce8c012c531/exec-87852388-1a84-4ce9-8504-d886cd44007e.png`
- Normalized binding source: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/01-events-ready-390x844.png`
- Physical implementation capture: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/01-events-ready-1170x2532.png`
- Accessibility capture: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/02-events-accessibility-large-390x844.png`
- Offline implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/03-events-offline-390x844.png`
- Offline accessibility capture: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/04-events-offline-accessibility-large-390x844.png`
- Combined comparison: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/events-option-2/comparison-source-vs-events.png`
- Viewport: exact 390 x 844 point iPhone 16e simulator capture, persisted at 1170 x 2532 pixels and normalized 1:1 to 390 x 844 for comparison
- State: two actor-visible event roots, one participant/published golf trip and one organizer/draft team event
- Focused comparison: the combined image keeps both complete 390 x 844 panels at 1:1 with a 16-pixel separator; typography, icons, chips, cards, gutters, and safe-area behavior remain directly readable without a separate crop

## Findings

- P0: none.
- P1: none.
- P2: none remaining. The first implementation capture used the full start and
  end date on one line, which wrapped at the normal viewport and weakened the
  source's compact card rhythm. Same-month ranges now use a compact localized
  label (`20.–24. September 2026`); the app was rebuilt and recaptured.

## Required fidelity surfaces

- Fonts and typography: DM Sans and the shared Crew typography tokens drive the
  display title, overlines, card titles, body text, and chips. Titles and
  metadata wrap without truncation.
- Spacing and layout rhythm: the screen uses a safe-area-aware scroll region,
  16-point page gutters, rounded outlined cards, hard shadows, compact metadata,
  and a clear source-matched hierarchy.
- Colors and visual tokens: lavender canvas, mint published card, gold draft
  card, purple supporting copy, white chips, and near-black outlines come from
  the shared Option-2 theme.
- Image quality and asset fidelity: the checked-in Crew logo, board background,
  golf, crew, calendar, retry, and arrow raster assets are crisp at simulator
  scale. No emoji, text symbol, inline SVG, or approximate drawn asset is used.
- Copy and content: German copy states event role, lifecycle, date, refresh
  phase, offline truth, count, loading, empty, and error plainly. No unavailable
  create or join capability is implied.

## Accessibility and interaction evidence

- Each entire card is a 48-point-or-larger accessible button and opens
  `EventInbound` by its exact `rootEventId`; the controller test verifies the
  production navigation seam.
- Role and lifecycle are present in visible text and in the card label, so state
  is not communicated by color alone. Only active memberships reach the view.
- Long titles have no `numberOfLines` or `maxFontSizeMultiplier` cap, chips wrap,
  and the whole content region scrolls.
- Loading, permitted-empty, retryable error, non-retryable unavailable, fresh,
  refreshing, cached offline, every active role and lifecycle, long title,
  missing date, and invalid time zone are covered by focused React Native tests.
- The offline refresh button is a shared Option-2 primitive with button
  semantics, an explanatory hint, and a tested callback. At accessibility-large
  it remains reachable by the screen's vertical scroll region.
- The persisted iOS `accessibility-large` state is the platform's near-200%
  body-text category. It grows the content vertically without horizontal
  clipping or a fixed-height trap; off-screen cards remain reachable by scroll.

## Production and proof boundary

- `EventsScreen` is the thin production controller over
  `ActorEventRootIndexStore`. Mobile-data tests prove that its only remote
  operation is generated-client `eventRootsList` with
  `includeArchived: 'false'`, while controller tests prove cached-first render,
  retry, exact-root selection, denial concealment, and account-switch safety.
- The realistic roots used for screenshots live only in
  `apps/mobile/evidence/events-option-2-entry.js`; they do not enter production
  routing or controller code.
- Gateway filtering remains authoritative; the SQLite boundary additionally
  rejects archived or non-active records and never broadens those results.
- The durable root index, refresh metadata, and selected root are isolated by
  account. Removal and authoritative denial purge the corresponding Event Hub
  projections, directory, and selection. Event Hub will not render a held
  projection for a root absent from the actor index.
- Separate follow-up `crew-paq.3.5.4` owns a real event creation flow.

## Comparison history

1. The binding source and initial Events capture were combined at the same
   390 x 844 viewport.
2. Review identified one P2 mismatch: the full localized date range wrapped in
   a normal-size card.
3. The date label gained a compact same-month form, then the Release app was
   rebundled, reinstalled, recaptured at 1170 x 2532, normalized, and recombined
   with the source at 1:1.
4. At capture time, the combined evidence and accessibility capture showed no
   actionable P0/P1/P2 mismatch; current manifest drift supersedes that result.
5. The durable actor-index follow-up added an explicit offline card and refresh
   control; normal and accessibility-large states were recaptured on the same
   iPhone 16e viewport and reviewed with no new P0/P1/P2 finding.

## Implementation checklist

- [x] Selected Option 2 source used as the binding visual truth.
- [x] Production-routed screen uses shared tokens, primitives, and real assets.
- [x] Controller uses only real Gateway root data and contains no fixture.
- [x] Cards navigate by `rootEventId`; no fake create/join action exists.
- [x] Loading, empty, retryable error, fresh, refreshing, and durable offline covered.
- [x] Account switch, restart, denial, removal, pagination, and cache retention covered.
- [x] Exact 390 x 844 and near-200% accessibility states persisted.
- [x] Source and implementation reviewed together in one 1:1 image.
- [ ] Regenerate source-current captures and repeat the combined visual gate.

current result: open; historical pass superseded by manifest drift
