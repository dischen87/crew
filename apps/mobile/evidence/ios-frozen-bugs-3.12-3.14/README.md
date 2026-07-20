# Frozen iOS bugs 3.12–3.14 — native Option-2 evidence

This folder closes the exact native iOS evidence requirements for
`crew-paq.3.12`, `crew-paq.3.13`, and `crew-paq.3.14`. All captures use the
frozen production Option-2 views and current source on the exact iPhone 16e at
390 x 844 points. No new design direction or product behavior was introduced.

## Result

- `crew-paq.3.12`: accepted. Event Hub and Recap top and materially scrolled
  states remain below the live 47-point status-bar viewport at normal text and
  Accessibility Large. Their first content starts without a second top inset.
- `crew-paq.3.13`: accepted. Recap moment body and overline use the existing
  `colors.text` value `#2D2D2D` on lavender `#D5C2E8`, measured at
  8.336:1. Mint, lavender, published, role and privacy states remain labelled
  with text or icons and do not rely on color alone.
- `crew-paq.3.14`: accepted. The unavailable auth eyebrow, title, guidance,
  status, privacy consequence and action each have a distinct job. The exact
  title phrase appears once, and no account, root, event, token, request, error
  reason or storage detail is visible.
- Independent visual review of all eleven current states and six combined
  comparison inputs found no remaining P0, P1 or P2 issue in this iOS slice.

## Current native captures

| Evidence                                                                                                      | Acceptance job                                                          |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Event Hub normal top](./01-event-hub-normal-top-390x844.png)                                                 | Live status bar, source-matched first position, no double inset         |
| [Event Hub normal scrolled](./02-event-hub-normal-scrolled-390x844.png)                                       | Material scroll with content clipped at, never above, the safe viewport |
| [Event Hub Accessibility Large top](./03-event-hub-accessibility-large-top-390x844.png)                       | Fully scaled hierarchy and fixed navigation                             |
| [Event Hub Accessibility Large scrolled](./04-event-hub-accessibility-large-scrolled-390x844.png)             | Route, timeline, update and fixed navigation remain reachable           |
| [Recap normal top](./05-recap-normal-top-390x844.png)                                                         | No double inset and complete organizer state hierarchy                  |
| [Recap normal scrolled](./06-recap-normal-scrolled-390x844.png)                                               | Material scroll, lavender moment and explicit privacy state             |
| [Recap Accessibility Large top](./07-recap-accessibility-large-top-390x844.png)                               | Fully scaled title, state chips and actions                             |
| [Recap Accessibility Large scrolled](./08-recap-accessibility-large-scrolled-390x844.png)                     | Dark lavender-moment text and reachable privacy explanation             |
| [Unavailable auth normal](./09-auth-unavailable-normal-390x844.png)                                           | Six distinct copy jobs and complete recovery action                     |
| [Unavailable auth Accessibility Large top](./10-auth-unavailable-accessibility-large-top-390x844.png)         | Natural title/guidance reflow without mid-word break or crop            |
| [Unavailable auth Accessibility Large actions](./11-auth-unavailable-accessibility-large-actions-390x844.png) | Status, privacy consequence and action remain reachable                 |

Each normalized image has a corresponding uncropped 1170 x 2532 simulator
capture in this folder. The status bar is live in every accepted image; no
status-bar override was used.

## Combined comparison inputs

- [Event Hub normal](./comparison-3.12-event-hub-normal-1560x894.png): binding
  Option-2 source, historical top, current top and current scrolled.
- [Event Hub Accessibility Large](./comparison-3.12-event-hub-large-1560x894.png):
  historical/current top and historical/current materially scrolled.
- [Recap normal](./comparison-3.12-3.13-recap-normal-1560x894.png): binding
  source, historical top, current top and current scrolled.
- [Recap Accessibility Large](./comparison-3.12-3.13-recap-large-1560x894.png):
  historical/current top and historical/current scrolled moment states.
- [Unavailable auth normal](./comparison-3.14-auth-normal-before-current-780x894.png):
  repeated-copy history beside the source-current distinct-job screen.
- [Unavailable auth Accessibility Large](./comparison-3.14-auth-large-top-actions-780x894.png):
  source-current top and action scroll states.

Every comparison keeps each 390 x 844 panel pixel-identical below its 50-pixel
provenance label. Historical panels explain the bug and are not presented as
current acceptance.

## Production and capture boundary

The existing deterministic entries were bundled separately:

- `apps/mobile/evidence/event-hub-option-2-entry.js` renders the production
  `EventHubView` and its checked-in Turkey Golf model.
- `apps/mobile/evidence/recap-option-2-entry.js` renders the production
  `RecapView` in the organizer-published state.
- `apps/mobile/evidence/auth-option-2-entry.js` renders the production
  `UnavailableView`.

The bundle ran in a copied Release simulator shell under the isolated bundle
ID `app.crew.next.frozenbugs.evidence`. The installed Debug app and its data
container were never replaced, uninstalled, cleared or opened by the evidence
entries. No Gateway, Keychain, private database, attachment store or production
controller was initialized. Peak temporary storage was 70,112 KiB, below the
1.5 GiB ceiling.

After capture, the isolated bundle and its runner processes were removed. The
Debug app bundle, preferences, every Crew SQLite file and the rendered
signed-out screen match their pre-capture SHA-256 baselines byte for byte; the
original Debug and iPhone 17 app processes, Metro ports, light appearance,
medium text size and `CrewEvidenceState=capability` setting are also restored.
iOS rewrote only its own HTTP-storage WAL/SHM and SplashBoard snapshot caches
when apps moved between foreground and background. Those volatile OS caches are
not protected Crew user data and are intentionally not claimed as byte-identical.

`native-visual-proof.json` freezes device facts, source hashes, contrast,
copy jobs, safe-area verdicts and the capture boundary. `asset-manifest.sha256`
binds every input, flow, current image, historical/reference panel, comparison,
test and document used for acceptance.

## Evidence limits

Screenshots establish visible reflow, crop, contrast appearance, status-bar
separation and reachable scroll states. They do not alone establish full WCAG
or VoiceOver compliance. Source inspection and focused tests separately bind
the 47-point margin pattern, zero residual top padding, labels, text tokens,
contrast calculation and concealed auth copy. Full mobile gates are recorded
in the Beads.
