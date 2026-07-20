# Event recap Option 2 design QA

> **Historical record, not current acceptance.** The current asset manifest has
> 19/36 mismatches, including 16 zero-digest stale sentinels. The review below
> records the previously accepted source/capture pair; it cannot establish the
> current Recap implementation until normal and scrolled Large-Text captures are
> regenerated from one frozen source and compared with the reference again.

- Source visual truth: `/Users/mathias/.codex/generated_images/019f7401-fc84-75a2-86e0-4ce8c012c531/exec-87852388-1a84-4ce9-8504-d886cd44007e.png`
- Normalized binding source: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Normal implementations: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/01-organizer-published-390x844.png` through `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/03-participant-offline-390x844.png`
- Accessibility implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/04-participant-offline-accessibility-large-390x844.png`
- Scrolled accessibility implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/05-participant-offline-accessibility-large-scrolled-390x844.png`
- Combined comparisons: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/comparison-reference-vs-recap.png` and `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/recap-option-2/comparison-reference-vs-recap-accessibility.png`
- Viewport: exact 390 x 844 point iPhone 16e simulator captures, persisted at 1170 x 2532 pixels and normalized 1:1 without cropping
- States: organizer published, organizer draft, participant published offline and participant offline at iOS Accessibility Large before and after a real scroll

## Findings

- P0: none.
- P1: none.
- P2: none remaining. The first large-type capture wrapped the original
  `Gemeinsame Momente` display title inside `Gemeinsame` and placed the longer
  connection label under unnecessary pressure. The final responsive marketing
  copy is `Eure Momente`, the honest offline action is `Online prüfen`, and the
  first synthetic moment is `Willkommen in Belek`. All type remains fully
  scaled; no cap, truncation or horizontal clipping was introduced.

## Required fidelity surfaces

- Fonts and typography: DM Sans and shared Crew typography tokens drive the
  display title, overline, event title, chips, body copy, review warning and
  controls. The hierarchy remains as bold and compact as the binding source.
- Spacing and layout rhythm: one safe-area-aware scroll region, 16-point page
  gutters, outlined rounded cards, hard control shadows, compact state metadata
  and action-first review hierarchy preserve the Option-2 rhythm.
- Colors and visual tokens: lavender canvas, mint success/actions, gold review
  warning, purple support copy, white surfaces and near-black outlines come
  only from the shared theme.
- Image quality and asset fidelity: the checked-in Crew logo, board background,
  arrow, check, calendar, crew and cloud-offline raster assets remain crisp at
  simulator scale. No emoji, inline SVG, text-symbol substitute or placeholder
  is visible.
- Copy and content: German copy distinguishes review, published availability,
  authorized offline state, online-only action and title-only external
  disclosure. It never exposes an account ID, root ID, source revision,
  provenance value, request identifier or share token.

## Accessibility and interaction evidence

- The exact 47-point top and 34-point bottom safe areas are applied once; the
  scroll view disables automatic content inset adjustment.
- Every button is a shared 48-point-or-larger accessible control. Chips and
  sync status state role and phase in text, not color alone.
- No relevant `Text` uses `numberOfLines`, `adjustsFontSizeToFit` or
  `maxFontSizeMultiplier`. Cards have no fixed height and the complete page is
  vertically scrollable.
- The final `accessibility-large` top capture shows `Eure Momente`, both status
  chips, timestamp and the complete `Online prüfen` CTA without word splitting
  or horizontal clipping. The paired scrolled capture shows both moment cards
  reached by an actual simulator drag.
- Loading and mutation feedback use live-region semantics. Destructive removal
  requires a native confirmation; offline mutation controls are absent rather
  than disabled promises.

## Production, privacy and offline proof

- `RecapScreen` is a thin production controller. It uses the active private
  SQLite database, exact session lifecycle, generated Gateway client,
  `onlineManager`, secure UUID generation and the native share sheet.
- `EventRecapController` is the single data boundary. It performs only generated
  `eventRecapsGet`, `eventRecapsGenerate`, `eventRecapsPublish`,
  `eventRecapsRemove`, `eventRecapShareLinksCreate` and
  `eventRecapShareLinksRevoke` operations.
- Authorized snapshots and idempotency attempts are account-and-root scoped.
  Share tokens are never stored. There is no recap outbox and an offline
  mutation exits before a Gateway request or command-attempt row.
- Local active membership guards manager operations and suppresses drafts for
  participant/viewer roles. Gateway 403/404, removed membership, invalid cache,
  account switch or returned state/version drift purges or conceals protected
  content as appropriate.
- Generation includes only locally cached, published, non-deleted event sources
  and the current root revision. Publish must return the exact requested
  published version; sharing requires that exact reviewed published cache.
- The screenshot fixture exists only in
  `apps/mobile/evidence/recap-option-2-entry.js`. No synthetic recap enters the
  production screen, controller, navigation or SQLite bootstrap.

## Comparison history

1. The binding source and three normal implementation states were captured at
   the same 390 x 844 viewport and combined at 1:1.
2. Review found one large-type P2: a long display word wrapped internally and
   the first CTA label consumed excessive width.
3. The title, CTA and synthetic moment copy were tightened without disabling
   scaling. The Release app was rebuilt, reinstalled and every affected state
   was recaptured.
4. The accessibility state was dragged through the real simulator and captured
   again after scrolling, proving vertical reach and uncut 200% content.
5. At capture time, both final composites were reviewed with the source in the
   same input and had no actionable P0/P1/P2 finding. Manifest drift now
   supersedes that result.

## Implementation checklist

- [x] Selected Option 2 source used as binding visual truth.
- [x] Production-routed screen uses shared tokens, primitives and real assets.
- [x] Organizer review/publish/remove/share/revoke and participant published read covered.
- [x] Generated Gateway client and account-scoped SQLite remain the only data boundaries.
- [x] Offline snapshots are authorized; every mutation is strictly online-only.
- [x] Removed, denied, private, malformed and drifted content fails closed.
- [x] Share disclosure is explicit, title-only and revocable; the token is not persisted.
- [x] Exact 390 x 844 and near-200% scrolled accessibility evidence persisted.
- [x] Focused and complete mobile/data/client/product gates pass.
- [ ] Regenerate source-current captures and repeat the combined visual gate.

current result: open; historical pass superseded by manifest drift
