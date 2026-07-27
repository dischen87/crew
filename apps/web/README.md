# Crew Next Closed Preview

`apps/web` is publicly deployed at `https://crew-haus.com/` as a Closed
Preview, not a general product launch. It intentionally remains `noindex` and
does not collect analytics or form data.

## Contact and launch gate

The CTA-specific blocker is the missing privacy-approved contact destination.
Mathias is the owner until the GTM plan delegates another DRI. After
Privacy/Security approval, configure one absolute, credential-free HTTPS target
as `PUBLIC_CLOSED_PREVIEW_CONTACT_URL`. Without that value, the visible
`Closed Preview anfragen` action stays disabled.

Local mobile/desktop browser acceptance is recorded in
`evidence/closed-preview-2026-07-20/`. Public Closed Preview delivery does not
turn that evidence into a general product launch. Contact activation remains
separately gated by Privacy/Legal approval, and analytics remain off unless an
explicit consent decision changes that boundary.

Do not substitute a placeholder recipient, App Store URL, client-only form, or
tracking endpoint.

The legacy dynamic invite route is intentionally inert and excluded from the
static Closed Preview build. Invite/download publication remains a separate
gateway- and release-gated surface.
