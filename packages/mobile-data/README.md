# Mobile data

SQLite is the sole post-sign-in read source for Crew mobile screens. This
package owns versioned local read-model SQL, queries, and the durable sync
engine. It depends on the generated Gateway client but deliberately has no
React dependency or network cache.

Revision, authorization-scope, collection-version, and sort-key values are
canonical decimal strings. Adapters must bind and return them as text without
coercing through JavaScript numbers. Feed chronology uses the immutable
creation revision, so a later edit cannot move an existing entry.

`SqlDatabase` is the platform seam. Tests wrap `bun:sqlite`; React Native should
adapt its SQLite driver as follows:

- `exec`, `run`, `all`, and `first` map to the driver's parameterized SQL calls.
- `transaction` must use an exclusive native transaction and must not resolve
  before its async callback completes.
- Open the database with platform file protection/encryption required by the
  account-data policy, then call `migrate` once before constructing
  `MobileDataStore`.

Every private row includes `account_user_id`. `clearUserData(userId)` deletes one
account through foreign-key cascades in one transaction. It intentionally
keeps other accounts and `public_places`; never put invite secrets, bearer
tokens, private payloads, or local attachment paths in `public_places`.

## Event-sync apply boundary

`MobileDataStore.applyBootstrapPage` stages every immutable bootstrap page and
replaces one root's complete server projection only when the final page commits.
A restart or failed final page leaves the previous readable graph and cursor
unchanged. `MobileDataStore.applyPullPage` requires the cursor used for the
request, applies the strictly ordered page and its checkpoint atomically, and
treats a repeated checkpoint as a replay.

The base wire types cover nine canonical event entities. Golf snapshots and
pulls additionally materialize round, current-account player, current-account
score, team, and aggregate leaderboard projections. Private event places live
in `event_places`, never in the logout-persistent `public_places` table. Six
partial tombstone variants are stored independently of full read-model rows, so
missing entities, duplicate deletes, and newer legitimate capability/reaction
upserts converge without fabricating unavailable fields.

Team collaboration snapshots use generated Gateway types and normalized
`SQL-TEAM` tables. Every account receives public teams and visible decisions;
only owners/organizers may materialize the assignment roster, and only the
current non-viewer account may materialize its own assignment and response.
`TeamOfflineStore` keeps the authoritative choice separate from the latest
durable local proposal, so a response rejected after an offline close remains
visible as `needs_attention` without exposing another member's response.

## Offline golf scores

`GolfOfflineStore` reads only account-scoped SQLite projections. Enqueuing a
score writes an immutable caller-owned `gsi_*` intent and computes the immediate
signed-handicap result through `@crew/shared/stableford` in one transaction.
The same intent ID and command is stable across restart, while reusing an ID for
a changed command fails. Active intents overlay the scorecard and ranking; a
persisted `converged` receipt keeps duplicate acknowledgements idempotent whether
the acknowledgement or pull wins the race.

`MobileSyncEngine.enqueueGolfScore` atomically links that local intent to one
generated `golf.score.set` mutation in the durable outbox. Golf shares the same
account/device/root wire sequence and sender as every other mutation; only
`eventId`, `hole`, `strokes`, and `putts` cross the API boundary. An applied
entity acknowledgement moves the linked intent to `awaiting_pull` (or directly
to `converged` if pull won the race), while authoritative pull data remains the
only value that replaces an optimistic score.

## Durable optimistic writes

Construct `MobileSyncEngine` with the migrated database, a generated
`GatewayClient`, and a callback that returns the currently active account ID.
Commands are derived from generated Gateway request types; callers must not
duplicate wire DTOs. Platforms without Web Crypto must also inject native
lowercase-UUID and SHA-256 providers through `randomUUID` and `sha256`.

- `enqueueRootCreate` persists the standalone event-create request, stable HTTP
  idempotency key, and optimistic overlay in one transaction.
- `enqueueMutation` allocates a gap-free sequence for one
  account/device/root stream and persists the immutable command plus overlay.
- `enqueueTeamAssignments`, `enqueueTeamDecision`, and `enqueueTeamResponse`
  derive the generated team mutations, enforce the locally known role, and
  bind response identity to the active account before immutable persistence.
- `listOptimisticMutations` returns overlays that screens may layer over the
  canonical SQLite projection. `listOutbox` also includes dead-letter proposals
  for explicit conflict UI.
- `syncRoot` is single-flight per engine and claims a database lease so another
  process cannot send the same root concurrently. The host should call it after
  a local write, foreground/connectivity opportunity, or explicit retry; one
  call sends at most one 100-mutation/1-MiB batch.

An in-flight batch stores its exact JSON body, SHA-256 fingerprint, mutation
IDs, and HTTP idempotency key before network I/O. A crash or lost response
therefore replays the same request. Applied overlays remain `awaiting_pull`
until their root revision arrives; terminal proposals remain visible as dead
letters, and a cursor expiry stages then atomically swaps a fresh snapshot
without dropping pending overlays.

`getStatus` exposes finite, safe UI states and copy (`pending`, `syncing`,
`waiting_retry`, `blocked`, `needs_attention`, `resetting`, or `synced`). Retry
uses full jitter from two seconds to fifteen minutes, honors a longer
`Retry-After`, and becomes visible after 20 failures or seven days. Persist only
the finite local error code and request ID—never a remote message body, bearer
token, invitation secret, pre-signed URL, attachment bytes, or local media URI.
