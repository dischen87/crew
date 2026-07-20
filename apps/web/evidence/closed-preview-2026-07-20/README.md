# Closed Preview browser acceptance — 2026-07-20

The static `apps/web` production preview was rendered with Google Chrome
150.0.7871.128 from repository revision
`8981694ef4f445ace48572166ac56ca8072142b6`.

## Result

- Mobile `390 x 844` and desktop `1440 x 1000` have no horizontal overflow,
  clipping, broken assets, or console errors.
- The checked-in DM Sans font loaded. The production page contains no scripts,
  forms, analytics, or external resource requests.
- `de-CH`, the self-canonical URL, one H1, and
  `noindex, nofollow, noarchive` are present.
- With no approved contact URL, exactly one visibly disabled
  `Closed Preview anfragen` button is rendered.
- The first keyboard stop exposes `Zum Hauptinhalt` with a four-pixel visible
  focus outline; activating it focuses `#hauptinhalt`.
- Reduced motion is active with zero running animations. A 200% desktop zoom
  simulation reflows at a 720 CSS-pixel layout viewport without horizontal
  overflow.
- `/join/LEGACY` returns `404` from the production preview.

## Captures

- `mobile-390x844.png` and `mobile-full-390.png`: exact viewport and full-page
  mobile render.
- `desktop-1440x1000.png` and `desktop-full-1440.png`: exact viewport and
  full-page desktop render.
- `desktop-skip-focus-1440x1000.png`: visible skip-link focus.
- `desktop-zoom-200-1440x1000.png`: 200% zoom-equivalent reflow.
- `comparison-source-mobile.png` and `comparison-source-desktop.png`: the
  binding Option-2 reference and each implementation render in one visual
  comparison.

The render closes the local browser/design acceptance only. It does not claim a
configured contact owner, Privacy/Legal approval, analytics consent,
deployment, live availability, or conversion evidence.
