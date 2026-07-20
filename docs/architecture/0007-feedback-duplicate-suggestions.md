# ADR-007: Privacy-safe feedback duplicate suggestions

- Status: Accepted
- Date: 2026-07-19
- Bead: `crew-paq.6.2.3`
- Depends on: [ADR-001](./0001-service-boundaries.md),
  [ADR-002](./0002-api-contract-standard.md)

## Contract

Mobile reads suggestions only through the generated Gateway operation
`eventFeedbackDuplicateSuggestionsList`:

```http
GET /core/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions?q=check%20in&limit=5&cursor=...
```

`q` is required and bounded to 2..500 characters, `limit` defaults to and cannot
exceed 5, and the response contains only:

```json
{
  "items": [
    { "id": "fbk_...", "title": "Check-in", "status": "open", "voteCount": 3 }
  ],
  "pageInfo": { "nextCursor": null, "hasMore": false }
}
```

The event service verifies active membership before executing the search and
then filters by the exact root, `visibility = public`, and canonical
`status <> duplicate`. An invalid query is rejected uniformly before any root
lookup. A valid query for an unknown root or non-member returns the same
concealed `404 NOT_FOUND`. The projection never contains body text, author
identity, diagnostics, attachments, context IDs, comments, duplicate links, or
cross-root relationships.

## Matching and ordering

This is a simple deterministic token match, not semantic, fuzzy, phonetic, or
AI similarity. The service applies Unicode NFKC normalization, lowercase
conversion, keeps Unicode letters/marks/numbers, collapses separators, removes
duplicate tokens, and considers at most the first 12 tokens. Every token must
occur in the normalized title/body. Candidates with more title-token matches
rank first; ties use `updatedAt DESC, id DESC`.

The signed keyset cursor is bound to the operation, principal, root, and
normalized query and carries rank, full PostgreSQL timestamp precision, and ID.
Changing the page limit is allowed; changing principal, root, or normalized
query invalidates the cursor. Equal rank/timestamp rows remain deterministic
because ID is the final key.

No search dependency or index is introduced for this root-local, rate-limited,
five-result read. Add a stored PostgreSQL search vector only after production
measurements show roots large enough for the scan to miss its latency target.

## Recovery and limits

The Gateway's authenticated-principal limiter applies before proxying and
returns `429 RATE_LIMITED` with `Retry-After`. A suggestion merged before it is
opened resolves through the existing canonical `SCR-061` redirect; private,
removed, or cross-root items remain concealed. Offline clients skip this read,
and a timeout, validation error, rate limit, or service error must never block
typing or discard the local feedback draft.
