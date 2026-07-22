# Recap caption field-reference key rotation

Caption-text consent uses a dedicated HMAC key domain. The authenticated recap
read model issues an opaque `rcf_...` reference bound to the exact recap,
source, immutable attachment and caption tuple. Neither the reference nor its
underlying attachment identity is stored in SQLite or exposed publicly.

Caption support remains disabled unless
`RECAP_EXTERNAL_CAPTIONS_ENABLED=true`. Production must keep the flag `false`
until Privacy/Legal approves the text-only projection and release evidence.

## Rotation

1. Generate a new random secret of at least 32 bytes for
   `RECAP_CAPTION_FIELD_REF_CURRENT_KEY`.
2. Move the old current secret to
   `RECAP_CAPTION_FIELD_REF_PREVIOUS_KEY` and deploy with the caption feature
   flag unchanged.
3. Verify that a fresh authenticated recap read issues a new reference, while
   an in-flight decision or link-create request using the previous reference
   still validates.
4. After old app sessions and grant-decision retries have drained, remove
   `RECAP_CAPTION_FIELD_REF_PREVIOUS_KEY`. A stale grant request then receives
   the same concealed `404` as an unknown field. An already-created valid link
   and its exact link-create replay remain bound to the internal PostgreSQL
   field identity and do not depend on retaining the old HMAC key.

Current and previous material must differ and must not equal invitation,
recap-share, sync, attachment, notification, place-candidate or place-search
secrets. New reads always issue with the current key; the previous key is
validation-only. Rotation does not change stored grants or links because
PostgreSQL stores the exact internal attachment field binding, never the HMAC
reference.

## Fail-closed checks

- Invalid, short, duplicate or cross-domain key material prevents startup.
- Enabling captions in production with either the built-in development key or
  the documented Compose-local key in the current or previous slot prevents
  startup. Those known local values remain accepted only while the caption
  feature flag is `false`.
- Removing the previous key makes stale refs invalid; the app must refresh the
  authenticated consent read model and never reconstruct a ref from cached
  recap data.
- Turning the feature flag off omits caption consent fields and conceals caption
  decisions, share creates/replays and existing public links with the same
  generic `404`.
