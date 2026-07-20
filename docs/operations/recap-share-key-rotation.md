# Recap-share token key rotation

Recap-share tokens use a dedicated HMAC key domain. PostgreSQL stores only the
key ID and SHA-256 token hash; idempotency responses never store the plaintext
token.

To rotate a key without breaking exact create replays:

1. Set a new `RECAP_SHARE_TOKEN_CURRENT_KEY_ID` and
   `RECAP_SHARE_TOKEN_CURRENT_KEY`.
2. Move the old values to `RECAP_SHARE_TOKEN_PREVIOUS_KEY_ID` and
   `RECAP_SHARE_TOKEN_PREVIOUS_KEY`.
3. Set `RECAP_SHARE_TOKEN_PREVIOUS_NOT_AFTER` to an ISO-8601 timestamp no more
   than seven days in the future and no earlier than the newest old link's
   expiry.
4. After that timestamp, remove all three previous-key settings.

For the first rollout over migration `0019_recap_share_token_keys.sql`, use
`legacy-invitation-v1` and the former invitation-token HMAC secret as the
bounded previous key. New current keys must remain distinct from invitation,
sync, attachment, notification, place-candidate and place-search secrets.

An already-issued token remains resolvable from its stored hash until the share
link expires or is revoked. The previous key exists only to reconstruct the
same plaintext token for an exact idempotency replay.
