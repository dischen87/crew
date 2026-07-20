# Crew Next Closed Preview — Design QA

- Source visual truth: `apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Implementation: static production preview at `http://127.0.0.1:4321/`
- Evidence: `apps/web/evidence/closed-preview-2026-07-20/`
- Required viewports: mobile `390 x 844`; desktop `1440 x 1000`
- State: Closed Preview, contact destination absent, CTA visibly disabled

## Findings

No P0, P1, or P2 visual, responsive, copy, or accessibility finding remains in
the local Closed Preview acceptance scope.

The first capture used Astro development mode and exposed its toolbar. It was
rejected and replaced with the static production preview. Every retained image
is therefore free of development overlays and Vite scripts.

## Fidelity and behavior

- DM Sans loads from the checked-in asset. Mobile and desktop preserve the
  binding Option-2 typography, lavender canvas, yellow frame, heavy ink
  outlines, rounded labels, and hard shadow language.
- The full uncropped binding reference is labelled as a concept and design
  direction, never as a shipped product screen.
- Approved Closed Preview copy is unchanged. No launch, availability, App
  Store, offline, analytics, or conversion claim was introduced.
- Mobile and desktop have no horizontal overflow, clipping, broken asset, or
  console error. The responsive composition keeps a clear reading order and a
  deliberate single-column mobile flow.
- The first keyboard stop is the visible skip link. Activation moves focus to
  the main content. The unavailable CTA is correctly omitted from tab order.
- Reduced-motion rendering has zero active animations. A 200% desktop
  zoom-equivalent render reflows without horizontal overflow.
- The production output has one H1, no script, no form, no external request,
  and one disabled CTA. The legacy join path returns `404`.

## Comparison evidence

- `comparison-source-mobile.png` pairs the binding `390 x 844` reference with
  the complete `390` CSS-pixel mobile page.
- `comparison-source-desktop.png` pairs the same binding reference with the
  full `1440` CSS-pixel desktop page.
- Exact viewport, full-page, focus, and 200% zoom captures are listed in the
  evidence README and protected by `asset-manifest.sha256`.

## Verification

- `bun run check`: passed.
- Static production page: script-free, `de-CH`, self-canonical,
  `noindex, nofollow, noarchive`.
- Chrome 150.0.7871.128: required viewports, focus, reduced motion, zoom,
  console, local-only resources, disabled CTA, and legacy `404` passed.

The page remains intentionally unpublished. Contact configuration,
Privacy/Legal approval, analytics/consent, deployment, live access, and
conversion evidence are separate release gates.

**final result: passed**
