# Crew Next Closed Preview

`apps/web` is a local, non-deployed Closed Preview surface. It intentionally
ships with `noindex` and does not collect analytics or form data.

## Publication gate

The CTA-specific blocker is the missing privacy-approved contact destination.
Mathias is the owner until the GTM plan delegates another DRI. After
Privacy/Security approval, configure one absolute, credential-free HTTPS target
as `PUBLIC_CLOSED_PREVIEW_CONTACT_URL`. Without that value, the visible
`Closed Preview anfragen` action stays disabled.

Publication remains separately gated by rendered mobile/desktop browser
acceptance, Privacy/Legal approval, an explicit analytics/consent decision, and
deployment/distribution evidence. This local build proves none of those gates.

Do not substitute a placeholder recipient, App Store URL, client-only form, or
tracking endpoint.

The legacy dynamic invite route is intentionally inert and excluded from the
static Closed Preview build. Invite/download publication remains a separate
gateway- and release-gated surface.
