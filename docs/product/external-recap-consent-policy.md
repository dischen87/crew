# External recap content consent policy

- Status: policy source of truth; exact event/feed body backend and bounded retention implemented, product rollout still gated
- Scope: public recap links only, not membership-gated recap inclusion
- Owning Bead: `crew-paq.2.15.4`

## Decision

Consent to use a source in the membership-gated recap is not consent to publish
that source outside the event. Crew treats these as two independent decisions.

The current public projection remains deliberately minimal. After reviewing
the exact title-only projection, a manager may create one opaque, seven-day link
for that explicitly named published recap version. The create request must use
version compare-and-set and the constant attestation
`title-only-reviewed`; that action authorizes only:

- the published recap title; and
- reindexed titles of valid published event sources.

Feed entries have no public title and are omitted. The response never contains
source bodies, descriptions, media, captions, URLs, structured identity or
membership fields, root/source/event/attachment IDs, provenance, internal
versions, timestamps, hidden-item counts or private error reasons.

Event titles are manager-authored free text; Crew cannot infer every name or
other personal detail from language. The review UI must show the exact public
projection and instruct the manager not to attest a title containing personal
data without the affected person's separate authority. The attestation is an
auditable publication decision, not an automated PII-classification claim.

The separate exact-body contract now permits event descriptions and feed bodies
only after the grants below. Missing consent means deny before link creation and
again at every resolution, not redact after delivery. It does not turn the
existing membership-gated source-consent field into an external-publication
grant. Captions, attachment bytes, public media URLs, identities, membership,
provenance, internal IDs and every other field remain unavailable.

## Current authority boundary

Only an active `owner` or `organizer` may create, rotate or revoke the bounded
public link. The creator must remain an active manager. Participants and
viewers cannot create a public link.

A manager's reviewed, version-bound title-link action is sufficient only for the
minimal title projection above. An exact-body link additionally requires a
current per-field manager grant and, for a feed body, a separate current grant
from the exact source author. Manager authority cannot replace that author. The
backend revalidates the exact current published recap, selected field, latest
decisions and decision actors' membership versions on replay and resolution; no
exported public snapshot survives source or authority changes.

## Exact-body model and remaining richer disclosure

Richer public content may be implemented only with all of these properties:

| Content | Required authority | Grant granularity | Backend state |
|---|---|---|---|
| Event-owned body or description | active owner/organizer | exact root, recap version, source ID, source version and body field | implemented |
| User-authored feed body | source author plus active manager publication | exact recap, source version and body field | implemented |
| Attachment caption | attachment creator plus active manager publication | exact attachment version and caption field | disabled |
| Attachment bytes or public media URL | attachment creator, active manager publication and separate media/privacy approval | exact attachment version; never inherited from body/caption consent | disabled |
| Identity, membership, provenance, internal IDs or audit data | not externally shareable | no grant type | prohibited |

Each grant must be an affirmative action after a preview of the exact fields.
It is never root-wide, inferred from membership, inherited by a later source
version or bundled into event participation. A source author may decline
without losing access to the event. Media containing identifiable people stays
disabled until the product has a separately reviewed subject-consent model;
uploader consent alone is insufficient.

## Revocation and lifecycle

External resolution fails closed with the same generic `404 NOT_FOUND` when any
of the following becomes true:

- the link expires, is revoked or is replaced;
- the root is archived or inaccessible;
- the link creator is no longer an active manager;
- the published recap changes, is removed or no longer validates;
- a source changes version, is deleted, tombstoned or loses its required
  publication/author consent; or
- a required external field grant is withdrawn or expires.

Crew does not reveal which condition failed and does not return a partially
stale version. With richer grants, withdrawal invalidates every dependent live
link immediately. Removing a source author from the root withdraws that
author's external grants unless a future legal/privacy review defines a more
restrictive deletion path; manager authority never replaces the author.

## Retention and audit

- Source content remains in its owning event tables and retention lifecycle; a
  consent record must not duplicate body or media content.
- Public-link rows store internal link/root IDs, token hash, token key ID, recap
  version, creator, timestamps and revocation state. Plain tokens are never
  persisted or logged and internal IDs never enter the public projection.
- Exact-body grant rows store source/field/version identifiers, actor,
  membership version, decision and timestamp, but no copied content, token,
  public IP or user agent. Exact field-binding and link-lifecycle audit rows are
  immutable to ordinary callers. Their only delete path is the dedicated
  least-privilege retention worker.
- The worker uses the database clock and bounded, indexed cursor windows. It
  deletes a complete exact-body link, its field binding and its lifecycle audit
  only after the earlier of revocation or expiry is at least 90 days old. A
  source-field-authority decision chain is eligible only when no dependent
  field remains and that authority's latest decision is at least 90 days old;
  bounded oldest-first deletion cannot reveal an older grant. Never-used old
  chains are covered, while recent, active, shared-dependent and ambiguous
  chains fail closed and are reconsidered after the cursor wraps.
- Retention never deletes or delays deletion of recap snapshots, event/feed
  sources or source content. Metrics are fixed aggregate scan/purge counts and
  ages only; no token, internal ID or content is logged. Product rollout remains
  gated on native UX and privacy/legal review; implementation is not approval.
- Public resolution is online-only and returns `Cache-Control: private,
  no-store`. Operational counters may record outcome classes without token,
  content, source IDs or requester fingerprinting.

The 90-day audit period is a product-security retention limit, not a legal or
compliance claim. Production release still requires privacy/legal review of the
deployment's jurisdiction and deletion obligations.

## Contract and error policy

The unchanged title-only public contract is exactly:

```json
{
  "recap": {
    "title": "Published event title",
    "items": [{ "ordinal": 0, "title": "Published item title" }]
  }
}
```

No optional richer fields were added to that schema. The separate exact-body
resolver returns only this strict shape:

```json
{
  "recap": {
    "title": "Published event title",
    "items": [
      { "ordinal": 0, "title": "Published item title", "body": null },
      { "ordinal": 1, "title": null, "body": "Approved feed body" }
    ]
  }
}
```

Each item must contain a title or an approved body, and ordinals are reindexed
contiguously. The grant model, bounded retention worker, migration, OpenAPI,
Gateway, generated client and Real-Postgres privacy tests are implemented.
Native preview/decision UX, copy review, security/privacy approval and release
evidence remain open. Unknown, malformed, revoked, expired, stale and
unauthorized tokens remain indistinguishable.

The create contract must reject a missing/unknown attestation and a recap
version that is no longer the current published version. Its full body is part
of the idempotency fingerprint, so a key cannot be replayed against a different
reviewed version.

## Required evidence

The current title-only boundary is releasable only while automated evidence
continues to prove that public resolution excludes:

- event, feed, user, attachment and upload identifiers;
- body and description markers;
- media type, hash, caption and object keys;
- provenance, source versions and membership data; and
- token plaintext in link or idempotency storage.

Tests must also cover creator authority loss, source drift/deletion, recap
replacement/removal, link rotation/revocation/expiry and generic errors. A
mockup, source-consent checkbox or membership-gated recap test is not evidence
for external disclosure.

Link-create tests additionally cover missing/invalid attestation, an exact
idempotent replay, stale requested version and a publication race before link
creation. Native release evidence must show the same version's title-only
preview before the create command.
