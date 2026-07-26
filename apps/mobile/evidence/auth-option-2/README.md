# Auth, invite, and protected-entry surfaces — Option 2 evidence

> **Current iOS evidence (2026-07-26):** These images were recaptured from the
> isolated Release evidence entry on an iPhone 16e simulator running iOS 26.2.
> Normal, Accessibility Large, and Accessibility Extra Large states were
> visually inspected against the binding Option-2 source. Current Android
> rendering, physical-device acceptance, and store-distributed proof remain
> external and are not claimed here.

This folder is the persistent visual and implementation evidence for
`crew-paq.3.5.3`. The production-routed sign-in, identity return, invite
preview, private-access, inbound-gate, and unavailable surfaces now use the
selected Crew Board Option-2 language without changing their existing
authentication, invitation, session, or deep-link state machines.

## Result

- `SignInView`, `EmailIdentityView`, `InvitePreviewView`,
  `PrivateAccessView`, `InboundGateView`, and `UnavailableView` are pure state
  surfaces behind their existing thin controllers.
- The shared `ScreenFrame` uses the real Crew logo, checked-in board
  background, DM Sans tokens, shared cards/chips/buttons/fields, and checked-in
  raster icons. Production contains no screenshot fixtures, emoji, inline SVG,
  handcrafted visible asset, or fake control.
- The controllers retain their existing generated Gateway calls, keychain
  pending records, idempotency keys, session replacement, query invalidation,
  and navigation destinations. No route or direct service call was added.
- Loading states do not expose fake actions. Terminal states consume protected
  pending records only where the existing flow requires it; retryable outages
  preserve them. A ready invite with an unavailable session offers a real
  `reloadSession` retry and does not redeem the invite.
- User-facing copy never renders a magic-link token, invite token, account ID,
  root/event ID, request ID, or backend error code. Missing, denied, and
  terminal protected targets remain deliberately indistinguishable where
  disclosure would weaken privacy.

## Persistent evidence

| Evidence                                                                                                                      | Purpose                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Accepted sign-in, 390 x 844](./01-sign-in-accepted-390x844.png)                                                              | Enumeration-safe accepted request and real retry action                               |
| [Expired identity return, 390 x 844](./02-identity-expired-390x844.png)                                                       | Terminal link state and real existing sign-in recovery                                |
| [Signed-out invite return, 390 x 844](./03-invite-signed-out-390x844.png)                                                     | Safe preview, role, email-bound hint, and real sign-in continuation                   |
| [Account mismatch, 390 x 844](./04-invite-account-mismatch-390x844.png)                                                       | Account-switch recovery without exposing either account                               |
| [Private access unavailable, 390 x 844](./05-private-unavailable-390x844.png)                                                 | Fail-closed private bootstrap recovery                                                |
| [Retryable inbound outage, 390 x 844](./06-inbound-retryable-390x844.png)                                                     | Concealed protected target with honest retry                                          |
| [Generic unavailable, 390 x 844](./07-unavailable-390x844.png)                                                                | Denied/missing target concealment and existing Events return                          |
| [Long invite at Accessibility Large, 390 x 844](./08-invite-long-text-accessibility-large-390x844.png)                        | Near-200% iOS text growth, wrapping, and scroll-safe layout                           |
| [Unavailable at Accessibility Extra Large, top, 390 x 844](./09-unavailable-accessibility-extra-large-top-390x844.png)        | Complete extra-large hierarchy with native wrapping and no horizontal clipping        |
| [Unavailable at Accessibility Extra Large, action, 390 x 844](./10-unavailable-accessibility-extra-large-actions-390x844.png) | A real native scroll reaches the existing Events return action                        |
| [Source versus auth/invite states](./comparison-reference-vs-entry-auth-invite.png)                                           | Binding source and four entry states at exact 1:1 390 x 844 panels                    |
| [Source versus recovery/access states](./comparison-reference-vs-access-recovery.png)                                         | Binding source and four recovery states at exact 1:1 390 x 844 panels                 |
| [Source versus unavailable normal/extra-large states](./comparison-reference-vs-unavailable-accessibility-extra-large.png)    | Binding source, normal unavailable, extra-large top, and scrolled action at exact 1:1 |
| [Design QA](./design-qa.md)                                                                                                   | Severity review, state truth, accessibility, and comparison history                   |

Every normalized image also has an unscaled 1170 x 2532 simulator capture in
this folder. The three comparison files keep each 390 x 844 panel intact with
a 16-pixel separator.

## State and controller proof

- Sign-in covers idle, locally invalid, submitting, accepted, and retryable
  unavailable states. Local validation is neutral/lavender without an offline
  icon; only a real request outage uses the cloud-offline treatment.
- Identity return covers loading, terminal invalid/expired, and retryable
  outage. Terminal errors consume the pending auth record; an outage retains
  both the link and protected return.
- Invite preview covers loading, ready, signed-out return, session preparation,
  unavailable session retry, email mismatch, terminal invalid/unusable, and
  retryable preview/redeem outage. Session retry invokes only `reloadSession`;
  it never redeems or consumes the pending invite.
- Private access covers bootstrap loading, required sign-in, and fail-closed
  unavailable recovery through the existing lifecycle controller.
- Routed inbound access uses generated-client `eventsGet`, reveals the title
  only after authorization, retries generic/retryable errors, and conceals
  authoritative missing/denied results. The generic unavailable surface never
  interprets or displays its route reason.

Focused controller tests prove keychain completion/retention order,
idempotency-key reuse, signed-out invite return, account switching, terminal
cleanup, successful invite navigation by returned root ID, retry without
redeem, and authorized/denied inbound behavior.

## Accessibility

- The exact iPhone 16e safe-area metrics are 390 x 844 with 47-point top and
  34-point bottom insets. Insets are applied once and the screen content is a
  vertical `ScrollView` with automatic adjustment disabled.
- Buttons use accessible labels/states and at least 48-point targets. Text
  fields have visible and programmatic labels plus error/help semantics.
- State transitions use polite or assertive live regions as appropriate; icon
  and color are always paired with explicit text.
- Small text meets normal-text contrast: the signed-out invite role overline
  uses near-black on gold at 9.57:1 rather than the former 4.24:1 purple.
- Titles and descriptions retain the shared `title` and `body` tokens without
  `numberOfLines` or a font multiplier cap. The ready-invite role likewise
  retains the shared `heading` token uncapped. At extreme Large Text the frame
  keeps a four-point horizontal gutter, uses iOS push-out line breaking, and
  relies on the existing vertical scroll path instead of shrinking type.
- At Accessibility Extra Large, a word wider than the remaining viewport can
  wrap at the native character boundary. The complete text remains rendered
  without horizontal clipping or truncation, and the real continuation action
  remains reachable.
- The persisted iOS `accessibility-large` screenshot is the platform's
  near-200% body-text category, not a claim that every display style receives
  one uniform 2.0 multiplier. Content grows vertically and remains scrollable.
- The `accessibility-extra-large` unavailable pair records both the complete
  top hierarchy and the existing `Zu Events` action after a real native scroll.
  It proves reachability on this simulator state, not Android parity.

## Production and evidence boundary

The isolated screenshot app is
`apps/mobile/evidence/auth-option-2-entry.js`. It renders only the exported pure
views with realistic synthetic state and alert-only evidence callbacks. It is
not imported by production code, does not initialize the Gateway, session,
keychain, or deep-link controllers, and cannot create a membership. Production
state-machine behavior is proved by the focused controller tests.

## Reproduction notes

The Release simulator app was bundled with the isolated evidence entry,
installed on the iPhone 16e simulator, and captured at 1170 x 2532 pixels.
`CrewEvidenceState` selected each pure-view state. Native swipes reset normal
screens to their top and reached the extra-large unavailable action before
capture. The iOS status bar was fixed to 09:41 for deterministic evidence.
Each comparison artifact uses complete 390 x 844 no-crop derivatives. Content
sizes were `large`, `accessibility-large`, and
`accessibility-extra-large`; the Simulator was restored to `large` and its
status-bar override cleared afterward. `asset-manifest.sha256` records the
exact evidence entry, binding source, production rendering inputs, and final
rendered outputs.
