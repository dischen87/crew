# Auth and protected-entry Option 2 design QA

> **Current iOS visual acceptance (2026-07-26).** The source-current Release
> evidence was recaptured on an iPhone 16e simulator running iOS 26.2 at
> normal, Accessibility Large, and Accessibility Extra Large content sizes.
> Every final normalized image and its raw no-crop source were inspected, and
> the binding source was reviewed in the same comparison images. Android,
> physical-device, and store-distributed acceptance remain external; this is
> therefore not a cross-platform release claim.

- Source visual truth: `/Users/mathias/.codex/generated_images/019f7401-fc84-75a2-86e0-4ce8c012c531/exec-87852388-1a84-4ce9-8504-d886cd44007e.png`
- Normalized binding source: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Primary implementation states: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/01-sign-in-accepted-390x844.png` through `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/07-unavailable-390x844.png`
- Accessibility implementation: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/08-invite-long-text-accessibility-large-390x844.png`, `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/09-unavailable-accessibility-extra-large-top-390x844.png`, and `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/10-unavailable-accessibility-extra-large-actions-390x844.png`
- Combined comparisons: `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/comparison-reference-vs-entry-auth-invite.png`, `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/comparison-reference-vs-access-recovery.png`, and `/Users/mathias/diisi_projekte/crew-new/apps/mobile/evidence/auth-option-2/comparison-reference-vs-unavailable-accessibility-extra-large.png`
- Viewport: exact 390 x 844 point iPhone 16e simulator captures, persisted at 1170 x 2532 pixels and normalized 1:1 for comparison
- States: accepted sign-in, expired identity return, signed-out invite return, invite account mismatch, private bootstrap unavailable, retryable inbound outage, generic denied/unavailable target, long invite at iOS Accessibility Large, and unavailable top/action at Accessibility Extra Large
- Focused comparison: all three combined files keep the complete binding source and complete implementation panels at 1:1 with 16-pixel separators; typography, assets, cards, gutters, actions, and safe-area behavior remain directly comparable

## Findings

- P0: none in the current iOS visual set.
- P1: none remaining in the current iOS visual set. Earlier review found that a ready invite with an unavailable
  private session initially had truthful copy but no operable recovery. It now
  offers `Zugang erneut prüfen`, calls only the existing `reloadSession`, and
  has controller proof that no invitation redeem or pending-record consume
  occurs.
- P2: none remaining in the current iOS visual set. Earlier review found that locally invalid email used the same
  gold/cloud-offline treatment as a network outage. Local validation is now
  neutral lavender with a field error and no offline icon; actual outages keep
  the distinct gold/cloud treatment. The small purple role overline on gold
  also measured 4.24:1; it now uses near-black ink at 9.57:1 and the affected
  normal/accessibility screenshots were rebuilt and recombined.

The two state-semantics findings did not affect the eight persisted screenshot
states and are covered by focused pure-view/controller tests. The role-overline
contrast fix did affect the signed-out and long-text invite screenshots, so
those captures and both combined comparison artifacts were rebuilt.

## Required fidelity surfaces

- Fonts and typography: DM Sans and the shared Crew typography tokens drive
  titles, overlines, descriptions, field copy, role details, chips, alerts, and
  actions. Text wraps naturally without truncation.
- Spacing and layout rhythm: each surface uses one safe-area-aware vertical
  scroll region, 16-point normal page gutters and a four-point extreme
  Large-Text gutter, a 52-point Crew mark, strong title hierarchy, outlined
  rounded cards, and source-matched hard shadows.
- Colors and visual tokens: lavender canvas, mint success/action surfaces,
  gold recovery/unavailable surfaces, purple supporting copy, white chips, and
  near-black outlines all come from the shared Option-2 theme.
- Image quality and asset fidelity: the checked-in Crew logo, board background,
  arrow, check, crew, and cloud-offline raster assets remain crisp at simulator
  scale. No emoji, text symbol, inline SVG, placeholder, or approximate drawn
  asset is used.
- Copy and content: German copy distinguishes local validation, accepted
  enumeration-safe requests, retryable outages, terminal links, account
  mismatch, signed-out return, session recovery, and concealed unavailable
  targets without exposing protected identifiers.

## Accessibility and interaction evidence

- The exact 47-point top and 34-point bottom safe areas are applied once at the
  390 x 844 viewport; automatic content-inset adjustment is disabled.
- The complete surface is vertically scrollable. Titles and descriptions wrap
  without `numberOfLines` or a font multiplier cap while retaining the shared
  `title` and `body` tokens. The invite role retains the shared `heading`
  token uncapped. The frame combines iOS push-out line breaking, a four-point
  extreme Large-Text gutter, and the existing vertical scroll path instead of
  downshifting typography. Every button has a 48-point-or-larger target.
- Inputs expose their visible label, help/error semantics, email keyboard
  behavior, and disabled state while submitting. Buttons expose label, busy,
  and disabled state.
- Loading, success, and failure transitions use polite/assertive live regions;
  no state relies on color or an icon alone.
- The iOS Accessibility Large capture shows the platform's near-200% body-text
  category with the long German title wrapping horizontally without clipping.
  Simulator accessibility inspection exposes the off-screen real continuation
  button, and the shared scroll shell plus focused test prove vertical reach.
- The Accessibility Extra Large unavailable pair shows the complete top
  hierarchy and the same screen after a real native scroll to `Zu Events`;
  neither panel clips horizontally or invents a replacement action. A word
  wider than the remaining viewport may wrap at the native character boundary
  without truncating content.

## State-machine and privacy proof

- Sign-in keeps normalized email, durable idempotency-key reuse, the generated
  public magic-link request operation, and enumeration-safe accepted copy.
- Identity redemption keeps opaque handle lookup, keychain token retrieval,
  generated redemption, session replacement before pending completion, and
  existing invite/Events return navigation. Terminal and retryable cleanup
  remain distinct.
- Invite preview keeps the generated public preview, authenticated idempotent
  redeem, successful query invalidation, returned-root navigation, email
  mismatch account switch, signed-out protected return, and terminal cleanup.
- Inbound authorization keeps generated `eventsGet`, account/root query
  scoping, session-failure reload, retryable refetch, and non-retryable
  concealment. No request, token, account, or root identifier reaches copy.
- `PrivateAccessView` and `UnavailableView` remain thin fail-closed surfaces;
  no new route, direct service client, fixture, or speculative action exists.

## Comparison history

1. The binding Option-2 source and seven normal implementation states were
   recaptured at the same 390 x 844 viewport and combined at 1:1.
2. The long signed-out invite was recaptured at iOS Accessibility Large and
   inspected for wrapping, safe-area use, scroll behavior, and accessible
   action exposure.
3. Root review identified the unavailable-session recovery P1 and local-invalid
   visual-semantics P2; both were corrected without changing routes or the
   invite/auth state machines.
4. Rams contrast review identified the 4.24:1 purple-on-gold role overline; it
   moved to 9.57:1 ink, and both affected screenshots and comparisons were
   regenerated and re-inspected.
5. The unavailable surface was recaptured at normal and Accessibility Extra
   Large sizes. A native scroll reached the real Events action; the top and
   action states were compared with the binding source in one 1:1 artifact.
6. Every 1170 x 2532 raw capture was deterministically normalized again and
   byte-compared with its checked-in 390 x 844 derivative before acceptance.

## Implementation checklist

- [x] Selected Option 2 source used as binding visual truth.
- [x] Six production-routed surface families use shared primitives and real assets.
- [x] Existing auth, invite, session, and deep-link controllers remain intact.
- [x] Loading, accepted, retryable, terminal, mismatch, signed-out, and denied states covered.
- [x] Tokens, accounts, root IDs, request IDs, and backend codes remain concealed.
- [x] Exact 390 x 844 and near-200% accessibility evidence persisted.
- [x] Source and implementations reviewed together in exact 1:1 composites.
- [x] Source-current iOS captures regenerated and combined visual gate repeated.
- [x] Accessibility Extra Large unavailable top and real-scrolled action persisted.
- [ ] Current Android normal and 2.0-font-scale visual parity (external).
- [ ] Physical-device and store-distributed acceptance (external).

current result: iOS visual P0/P1/P2 pass; Android and physical/store proof external
