# External recap content consent policy

- Status: policy source of truth; exact body and caption-text engineering implemented, caption rollout disabled by default and still gated
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

The separate exact-field contract permits event descriptions, feed bodies and,
only while the server caption gate is enabled, attachment caption text after
the grants below. Missing consent means deny before link creation and again at
every resolution, not redact after delivery. It does not turn the existing
membership-gated source-consent field into an external-publication grant.
Attachment bytes, public media URLs, identities, membership, provenance,
internal IDs and every other field remain unavailable. Production defaults
`RECAP_EXTERNAL_CAPTIONS_ENABLED` to `false`; enabling it requires the separate
privacy/legal release decision described below.

## Current authority boundary

Only an active `owner` or `organizer` may create, rotate or revoke the bounded
public link. The creator must remain an active manager. Participants and
viewers cannot create a public link.

A manager's reviewed, version-bound title-link action is sufficient only for the
minimal title projection above. An exact-field link additionally requires a
current per-field manager grant and, for a feed body or caption, a separate
current grant from the exact source author or attachment creator. Manager
authority cannot replace that author. The backend revalidates the exact current
published recap, selected field, latest decisions and decision actors'
membership versions on replay and resolution; no exported public snapshot
survives source or authority changes.

## Exact-field model and remaining richer disclosure

Richer public content may be implemented only with all of these properties:

| Content                                                      | Required authority                                                                 | Grant granularity                                                                    | Backend state                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Event-owned body or description                              | active owner/organizer                                                             | exact root, recap version, source ID, source version and body field                  | implemented                                                |
| User-authored feed body                                      | source author plus active manager publication                                      | exact recap, source version and body field                                           | implemented                                                |
| Attachment caption text                                      | attachment creator plus active manager publication                                 | exact immutable attachment/version/caption tuple via an opaque server HMAC reference | implemented behind a server-default-off privacy/legal gate |
| Attachment bytes or public media URL                         | attachment creator, active manager publication and separate media/privacy approval | exact attachment version; never inherited from body/caption consent                  | disabled                                                   |
| Identity, membership, provenance, internal IDs or audit data | not externally shareable                                                           | no grant type                                                                        | prohibited                                                 |

Caption references are issued only in the authenticated, no-store consent read
model. The app receives `rcf_...`, caption text, display ordinal and version,
but no attachment ID, creator ID, media URL, hash, MIME type or object key. The
reference binds root, recap version/ordinal, feed source and version, immutable
attachment identity/version/revision/creator and exact caption. Current and
previous HMAC keys support bounded rotation; refs are never persisted in
SQLite, navigation, diagnostics or the public projection.

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
- an attachment caption source is deleted by its normal retention lifecycle;
  or
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
- Exact-field grant rows store source/field/version identifiers, actor,
  membership version, decision and timestamp, but no copied content, token,
  public IP or user agent. Exact field-binding and link-lifecycle audit rows are
  immutable to ordinary callers. Their only delete path is the dedicated
  least-privilege retention worker.
- The worker uses the database clock and bounded, indexed cursor windows. It
  deletes a complete exact-field link, its field binding and its lifecycle audit
  only after the earlier of revocation or expiry is at least 90 days old. A
  source-field-authority decision chain is eligible only when no dependent
  field remains and that authority's latest decision is at least 90 days old;
  bounded oldest-first deletion cannot reveal an older grant. Never-used old
  chains are covered, while recent, active, shared-dependent and ambiguous
  chains fail closed and are reconsidered after the cursor wraps.
- External-consent metadata retention never deletes or delays deletion of recap
  snapshots, event/feed sources or source content. Normal attachment retention
  remains allowed; deleting a bound attachment makes every dependent caption
  link resolve to the same concealed `404`. Metrics are fixed aggregate
  scan/purge counts and ages only; no token, internal ID or content is logged.
  Caption rollout remains gated on privacy/legal approval and release evidence;
  implementation is not approval.
- Public resolution is online-only and returns `Cache-Control: private,
no-store`. Operational counters may record outcome classes without token,
  content, source IDs or requester fingerprinting.
- The attachment worker has only `SELECT` on committed attachments: no
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` or
  `MAINTAIN`. Its only committed-row cleanup path is a
  `SECURITY DEFINER` function that verifies the exact active cleanup claim,
  lease owner, fence, root, upload, attachment, object key and unbound feedback
  target in one statement. Feed attachments, linked feedback attachments,
  foreign-root guesses and stale or repeated claims cannot use that path;
  owner-controlled retention and migration deletes remain separate; the runtime
  API has only `SELECT` and `INSERT`: no direct `UPDATE`, `DELETE`, `TRUNCATE`,
  `REFERENCES`, `TRIGGER` or `MAINTAIN` on committed attachments.

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

No optional richer fields were added to that schema. The separate exact-field
resolver returns only this strict shape; captions contain text only:

```json
{
  "recap": {
    "title": "Published event title",
    "items": [
      {
        "ordinal": 0,
        "title": "Published item title",
        "body": null,
        "captions": []
      },
      {
        "ordinal": 1,
        "title": null,
        "body": "Approved feed body",
        "captions": ["Approved attachment caption"]
      }
    ]
  }
}
```

Each item must contain a title, an approved body or an approved caption, and
ordinals are reindexed contiguously. The grant model, bounded retention worker,
migrations, OpenAPI, Gateway, generated client, ephemeral MobileData binding and
Design-2 native preview/decision UX are implemented. Caption device evidence,
security/privacy approval, deployment and release evidence remain open.
Unknown, malformed, revoked, expired, stale and unauthorized tokens remain
indistinguishable.

The create contract must reject a missing/unknown attestation and a recap
version that is no longer the current published version. Its full body is part
of the idempotency fingerprint, so a key cannot be replayed against a different
reviewed version.

## Required evidence

The current title-only boundary is releasable only while automated evidence
continues to prove that its public resolution excludes:

- event, feed, user, attachment and upload identifiers;
- every body, description and caption marker;
- media type, hash and object keys;
- provenance, source versions and membership data; and
- token plaintext in link or idempotency storage.

An enabled exact-field boundary may return only the explicitly selected,
approved body and caption strings for the exact current version. Automated
evidence must prove that it excludes every unselected or unapproved body,
description and caption marker, plus all identifiers, media metadata,
provenance, membership data and token plaintext named above.

Tests must also cover creator authority loss, source drift/deletion, recap
replacement/removal, link rotation/revocation/expiry and generic errors. A
mockup, source-consent checkbox or membership-gated recap test is not evidence
for external disclosure.

Caption tests additionally cover opaque-ref current/previous overlap and
retirement, every bound tuple field drifting, stable refs and links when an
earlier caption sibling is deleted and ordinals compact, immutable-row update
rejection, the least-privilege feedback-cleanup role matrix, attachment
retention deletion, default-off read/write/replay/resolve behavior and exact
text-only projection without sibling captions or media metadata.

Link-create tests additionally cover missing/invalid attestation, an exact
idempotent replay, stale requested version and a publication race before link
creation. Native release evidence must show the same version's title-only
preview before the create command.
