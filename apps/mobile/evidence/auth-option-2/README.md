# Auth, invite, and protected-entry surfaces — Option 2 evidence

> **Stale evidence:** These native images predate the current unavailable view
> and shared `ScreenFrame`. The hardened manifest deliberately fails through
> stale sentinels until the unavailable normal/Large Text/Android evidence is
> recaptured from the final shared source.

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

| Evidence                                                                                               | Purpose                                                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [Accepted sign-in, 390 x 844](./01-sign-in-accepted-390x844.png)                                       | Enumeration-safe accepted request and real retry action               |
| [Expired identity return, 390 x 844](./02-identity-expired-390x844.png)                                | Terminal link state and real existing sign-in recovery                |
| [Signed-out invite return, 390 x 844](./03-invite-signed-out-390x844.png)                              | Safe preview, role, email-bound hint, and real sign-in continuation   |
| [Account mismatch, 390 x 844](./04-invite-account-mismatch-390x844.png)                                | Account-switch recovery without exposing either account               |
| [Private access unavailable, 390 x 844](./05-private-unavailable-390x844.png)                          | Fail-closed private bootstrap recovery                                |
| [Retryable inbound outage, 390 x 844](./06-inbound-retryable-390x844.png)                              | Concealed protected target with honest retry                          |
| [Generic unavailable, 390 x 844](./07-unavailable-390x844.png)                                         | Denied/missing target concealment and existing Events return          |
| [Long invite at Accessibility Large, 390 x 844](./08-invite-long-text-accessibility-large-390x844.png) | Near-200% iOS text growth, wrapping, and scroll-safe layout           |
| [Source versus auth/invite states](./comparison-reference-vs-entry-auth-invite.png)                    | Binding source and four entry states at exact 1:1 390 x 844 panels    |
| [Source versus recovery/access states](./comparison-reference-vs-access-recovery.png)                  | Binding source and four recovery states at exact 1:1 390 x 844 panels |
| [Design QA](./design-qa.md)                                                                            | Severity review, state truth, accessibility, and comparison history   |

Every normalized image also has an unscaled 1170 x 2532 simulator capture in
this folder. The two comparison files keep each 390 x 844 panel intact with a
16-pixel separator.

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
- Titles, descriptions, role labels, chips, errors, and actions have no
  `numberOfLines` or restrictive font-multiplier cap. The Simulator
  accessibility tree exposes the long invite and its real continuation action.
- The persisted iOS `accessibility-large` screenshot is the platform's
  near-200% body-text category, not a claim that every display style receives
  one uniform 2.0 multiplier. Content grows vertically and remains scrollable.

## Production and evidence boundary

The isolated screenshot app is
`apps/mobile/evidence/auth-option-2-entry.js`. It renders only the exported pure
views with realistic synthetic state and alert-only evidence callbacks. It is
not imported by production code, does not initialize the Gateway, session,
keychain, or deep-link controllers, and cannot create a membership. Production
state-machine behavior is proved by the focused controller tests.

## Reproduction notes

The Release simulator app was bundled with the isolated evidence entry,
installed on the iPhone 16e simulator, and captured at 1170 x 2532 pixels. Each
comparison artifact was normalized to exactly 390 x 844 without cropping. The
Simulator content size was restored to `large` after the accessibility capture.
`asset-manifest.sha256` records the exact evidence entry, binding source, and
rendered outputs.
