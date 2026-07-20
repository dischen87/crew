# Native E2E Oracle responsive QA

Date: 2026-07-19  
Viewport: iPhone 16e, `390×844`

## Same-state comparison

[Before and after](comparison-ios-oracle-before-after-responsive.png) places
the same participant account, root, delivered-empty outbox and pull-cursor
state side by side at the same viewport.

- Before: the three equal-width cards split `Ausstehend`, `Aufmerksamkeit` and
  `NEIN` across lines inside words.
- After: each sanitized metric uses one full-width card. Every label and value
  is complete, and the cursor plus both actions remain visible.
- The route, account boundary, pending/attention values, cursor fingerprint and
  privacy-safe field set are unchanged.

The after capture is
[ios-16-participant-outbox-oracle-delivered-responsive-390x844.png](ios-16-participant-outbox-oracle-delivered-responsive-390x844.png).
The focused render contract passes 6/6 tests, including full-width metrics at
390 px and unrestricted font scaling without ellipsis, line caps or font-size
clamps.

## Accessibility Large boundary

[Accessibility Large top](ios-17-participant-outbox-oracle-delivered-responsive-accessibility-large-390x844.png)
is a real simulator capture. It proves the title and explanatory copy reflow
instead of clipping, but it is only the top state: the full metric/action area
is below the fold. A real scrolled Accessibility Large capture remains required
before claiming complete native Large Text visual acceptance.
