# Crew Next Closed Preview — Design QA

- Source visual truth: `apps/mobile/evidence/event-hub-option-2/reference-390x844.png`
- Implementation: `http://127.0.0.1:4321/` (local only)
- Implementation screenshot: unavailable
- Required viewports: mobile `390 × 844`; desktop `1440 × 1000`
- State: Closed Preview, contact destination absent, CTA visibly disabled

## Findings

- [P1] Browser-rendered implementation evidence is unavailable.
  - Location: full page, mobile and desktop.
  - Evidence: the binding source image was opened at its original `390 × 844`
    size. Browser runtime discovery returned no available in-app Browser or
    Chrome surface, so no implementation screenshot could be captured.
  - Impact: composition, wrapping, crop, overflow, font rendering, focus
    appearance and responsive behavior cannot receive final visual acceptance.
  - Fix: use an approved Browser or Chrome surface to capture the local page at
    both required viewports, then compare each implementation capture together
    with the source image in one comparison input.

## Required fidelity surfaces

- Fonts and typography: the implementation reuses the checked-in variable
  `DM Sans.ttf`, with the Option-2 display weight and tracking. Actual browser
  font loading, antialiasing and line wrapping remain unverified.
- Spacing and layout rhythm: CSS uses the binding Option-2 spacing, radii,
  three-pixel outlines and hard shadows. The `820px` and `520px` breakpoints
  are statically present; rendered desktop/mobile rhythm remains unverified.
- Colors and visual tokens: the page uses the production Option-2 canvas,
  paper, ink, gold, mint and purple values from `apps/mobile/src/design/theme.ts`.
  Static WCAG ratios pass for the used pairs: purple/canvas `4.76:1`,
  purple/paper `6.11:1`, ink/gold `9.57:1`, ink/mint `10.36:1`, disabled
  text/surface `6.05:1` and status/canvas `7.04:1`. Rendered contrast remains
  visually unverified.
- Image quality and asset fidelity: the real Crew logo, Crew Board background
  raster and full uncropped binding reference are bundled locally. No CSS art,
  handcrafted SVG, emoji, placeholder mockup or generated fake asset is used
  on the page. The screenshot is explicitly labelled as a concept image and not
  a final product view.
- Copy and content: the hero eyebrow, headline, body and CTA match the approved
  Closed Preview copy. The only additional customer-visible text discloses the
  unpublished contact gate and concept-image status. No launch-gated feature,
  availability, App Store or offline claim is present.
- Accessibility and behavior: semantic header/main/footer, one H1, skip link,
  native disabled button, `aria-describedby`, visible focus CSS, fixed image
  dimensions, `de-CH`, and reduced-motion handling pass static inspection.
  Keyboard traversal, text zoom and screen-rendered focus remain unverified.

## Full-view comparison evidence

Blocked. No browser-rendered implementation screenshot exists, so a combined
source-versus-implementation comparison cannot be produced honestly.

## Focused region comparison evidence

Blocked for the same reason. After capture, inspect the header/logo, hero type
wrap, CTA disabled state, screenshot frame/caption and mobile footer separately.

## Static verification

- `bun run check`: passed.
- Static Astro build: one page emitted; legacy dynamic invite route omitted.
- HTTP smoke: `/` returned `200`; `/join/LEGACY` returned `404`.
- Config seam: an absolute HTTPS test destination rendered the CTA as one real
  link; the default unconfigured build rendered one disabled button.
- Built HTML: `de-CH`, self-canonical, `noindex, nofollow, noarchive`, one H1,
  one CTA, script-free, no forms, no placeholder links and no external fonts.

## Comparison history

No visual iteration has started. The source is available, but the first
implementation capture is blocked by the missing approved browser surface.

## Implementation checklist

1. Open the existing local preview in an approved in-app Browser or Chrome.
2. Capture `390 × 844` and `1440 × 1000` without changing page state.
3. Test skip-link focus, keyboard order, 200% text, reduced motion and console.
4. Compare each capture with the binding source in the same visual input.
5. Fix every P0/P1/P2 mismatch and repeat before changing the result below.

**final result: blocked**
