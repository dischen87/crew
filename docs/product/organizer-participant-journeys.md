# Crew Next organizer and participant journeys

- Status: Current product contract
- Date: 2026-07-18
- Bead: `crew-paq.4.2`
- Domain basis: [ADR-003](../architecture/0003-event-domain.md)
- Cutover basis: [Migration Plan 004](../architecture/0004-additive-cutover.md)

## Outcome

These journeys define the smallest complete mobile experience shared by a
Turkey golf tour and a non-travel team event. They keep behavioral requirements
separate from layout, color, type, and motion tokens so those requirements stay
testable. Every implementation and rendered handoff uses the binding
[Option 2 / Crew Board direction](./figma-handoff/README.md); the earlier visual
alternatives are superseded and must not be selected or blended.

The same journey spine serves both fixtures:

```text
create draft -> add plan -> invite -> publish -> join -> prepare
             -> participate live -> communicate -> give feedback -> recap
```

A root event is the authorization, membership, sync, and cutover boundary.
Templates may prefill capabilities and children, but they do not create a
second model. The native app talks only to the API gateway and never asks a
person to choose between legacy and Next.

## Journey rules

1. Every actionable step below names exactly one primary action. Secondary
   actions may exist, but they must not compete with it.
2. SQLite is the immediate read model. Previously synced content remains usable
   while background refresh, retry, or enrichment is in progress.
3. A local write is visibly `Saving`, `Queued`, `Needs attention`, or `Synced`.
   The app never labels a queued write as delivered.
4. A blocked network operation preserves entered data and the intended return
   route. Signing in, redeeming a new invitation, fetching an unseen root,
   managing an external recap link, and resolving that link require a
   connection.
5. Conflicts never discard either version silently. The local version remains
   recoverable until the person accepts a resolution.
6. Event type changes vocabulary and suggested capabilities, not roles,
   permissions, feed behavior, or sync behavior.
7. Empty states explain what is missing and offer one role-appropriate next
   action. A viewer never sees a disabled write action as an invitation to
   upgrade their rights.

## Actors and permissions

In the journey labels, **organizer** means an `owner` or `organizer` unless an
owner-only exception is named. Membership is root-scoped and inherited by every
descendant.

| Role        | Journey rights                                                                                                                                                                                                           | Explicit boundary                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner       | Everything an organizer can do; invite/promote organizers, transfer ownership, archive the root                                                                                                                          | Exactly one active owner; transfer and archive are never delegated implicitly                                                                                                                                                                                   |
| Organizer   | Create/edit/reorder/cancel descendants, configure itinerary and capabilities, invite participants/viewers, moderate participant content, publish updates/recap, and create/rotate/revoke the bounded external recap link | Cannot invite/promote another organizer, transfer ownership, or archive the root                                                                                                                                                                                |
| Participant | Read published content; complete permitted personal actions; post, react, score, vote, comment, and edit/delete own permitted contributions                                                                              | Cannot see drafts, change the event graph, manage membership, moderate others, or create/revoke an external recap link; participant link creation is not allowed by the current [external recap consent policy](./external-recap-consent-policy.md) or contract |
| Viewer      | Read published content and recap                                                                                                                                                                                         | Cannot post, react, score, vote, comment, or change event state                                                                                                                                                                                                 |

Removed or left members retain no event access. Cached content is locked on the
next authorization result, and rejected offline writes remain exportable to the
person instead of being sent under another identity.

## Evidence vocabulary

Each step names the proof needed before that step is accepted.

| Code           | Evidence                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `DEVICE`       | Screen recording on supported iOS and Android devices, including the named state and exactly one primary action      |
| `A11Y`         | VoiceOver and TalkBack traversal, large text, focus order, labels, and non-color status checks                       |
| `API`          | Gateway trace plus owning-service response proving actor, root, permission, idempotency, and standard error behavior |
| `DB`           | Real-Postgres integration assertion for graph, version, revision, tombstone, membership, or outbox invariants        |
| `SQLITE`       | Temporary real-SQLite assertion for local transactions, read models, overlays, outbox ordering, and recovery         |
| `OFFLINE`      | Airplane-mode recording plus SQLite/outbox evidence before and after reconnect, including duplicate delivery         |
| `LINK`         | Cold start, warm start, signed-out return, expired/revoked link, and unauthorized-link test                          |
| `FIXTURE-GOLF` | Deterministic Turkey golf-tour fixture read through the gateway                                                      |
| `FIXTURE-TEAM` | Deterministic non-travel team-event fixture read through the gateway with no travel/golf dependency                  |

## Shared organizer journey: create, invite, and publish

### `O-01` Start a root

- **User goal:** Start planning without configuring the whole event up front.
- **Primary action:** `Create event`.
- **System result:** A client-stable root ID and mutation ID create a private
  draft; the creator becomes its owner. The draft appears in the event list
  immediately and syncs idempotently.
- **States and recovery:** Empty event list explains what Crew does. First-load
  failure offers `Try again`. Offline creation is allowed as a queued draft,
  but inviting and publishing remain unavailable until the root is accepted by
  the server. A rejected client ID keeps the entered draft and offers `Retry`.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `OFFLINE` prove one root,
  one active owner, one retry-safe create, and no duplicate after reconnect.

### `O-02` Choose the starting shape

- **User goal:** Get sensible defaults for the occasion without learning the
  domain model.
- **Primary action:** `Use this setup`.
- **System result:** Choosing Turkey golf tour suggests a `trip` root with
  travel and golf planning; choosing team event suggests a `team_event` root
  with team, session, and activity planning. Both remain editable recursive
  graphs.
- **States and recovery:** If suggestions cannot load, a minimal blank setup is
  available through `Start blank`. Offline uses the last bundled template
  schema. An obsolete queued template version preserves entered core details
  and offers `Review setup` after sync.
- **Acceptance evidence:** `FIXTURE-GOLF` and `FIXTURE-TEAM` show different
  capabilities over the same event, membership, feed, and sync primitives.

### `O-03` Name and date the root

- **User goal:** Make the event recognizable and locally correct.
- **Primary action:** `Save details`.
- **System result:** Title and IANA time zone are saved; optional date range,
  description, and cover become the root summary. Times are stored as UTC
  instants with explicit display zones.
- **States and recovery:** Validation stays beside the affected field and does
  not erase other values. Offline save queues. A stale root version offers
  `Review changes`, retaining both local and server values.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, and `OFFLINE` prove required
  fields, local-time rendering across a DST boundary, and recoverable conflict.

### `O-04` Build the event tree

- **User goal:** Break the event into days, rounds, sessions, or activities.
- **Primary action:** `Add to plan`.
- **System result:** A child event or itinerary item is added at the selected
  parent with a server-authoritative sibling order. Descendants inherit root
  membership and remain in the same sync boundary.
- **States and recovery:** An empty plan explains examples appropriate to the
  selected setup. Offline additions queue with stable IDs. A concurrent reorder
  offers `Review order`; an invalid cycle, deleted parent, or cross-root move
  offers `Choose another parent` without losing the draft child.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `OFFLINE` prove multiple
  depths, no cycle, no cross-root move, deterministic order, and duplicate-safe
  retry.

### `O-05` Configure what people need

- **User goal:** Add only the planning details required for this event.
- **Primary action:** `Save setup`.
- **System result:** Typed capabilities and itinerary details are attached to
  the relevant event: travel/lodging/transport/golf for the tour, or team and
  session/activity details for the offsite. Requested participant inputs are
  explicit and capability-specific.
- **States and recovery:** Empty optional capabilities do not block publishing.
  Provider-backed place search may show `Searching`; manual name/locality entry
  remains available. Offline edits queue against the cached schema. Removing a
  capability with live dependencies offers `Resolve dependencies` rather than
  deleting them.
- **Acceptance evidence:** `FIXTURE-GOLF`, `FIXTURE-TEAM`, `API`, and `DB` prove
  closed schemas, dependency protection, and that the team fixture contains no
  travel or golf fields.

### `O-06` Check readiness

- **User goal:** Know what will be visible and what still needs attention.
- **Primary action:** `Review event`.
- **System result:** A role-correct preview lists blocking validation separately
  from optional improvements, shows the published hierarchy and itinerary, and
  conceals drafts from participants.
- **States and recovery:** With no blocking issue, the preview says it is ready.
  Missing required data links to the exact editor through `Fix first issue`.
  Cached preview remains readable offline, while publish itself waits for
  connection. A newer organizer revision offers `Refresh review`.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, `FIXTURE-GOLF`, and
  `FIXTURE-TEAM` prove the preview matches participant reads and exposes no
  drafts.

### `O-07` Create an invitation

- **User goal:** Give the right people the right root-scoped access.
- **Primary action:** `Create invite`.
- **System result:** The event service returns the plain invite token once and
  stores only its hash. Owner may grant organizer/participant/viewer; organizer
  may grant participant/viewer. Expiry, email hint, and use limit are explicit.
- **States and recovery:** With no invites, the state explains roles. Offline
  invite creation is not pretended to succeed and offers `Create when online`.
  Permission, validation, or concurrent last-use errors preserve policy fields.
- **Acceptance evidence:** `DEVICE`, `API`, and `DB` prove role limits, hashed
  storage, expiry/revocation/use-count behavior, and absence of tokens in logs.

### `O-08` Publish and share

- **User goal:** Make the reviewed event available and send a usable link.
- **Primary action:** `Publish event`.
- **System result:** The root becomes published at one root revision. The app
  then exposes the already-created invitation through the platform share sheet;
  sharing does not create membership.
- **States and recovery:** No connection or unresolved queued root writes keeps
  the root draft and offers `Sync and publish`. A version conflict offers
  `Review changes`. Share cancellation leaves the invite usable; a revoked
  invite cannot be copied as active.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, `OFFLINE`, and `LINK` prove a
  single publish revision, no partial visibility, and a valid deep link.

## Shared participant journey: invitation, join, and preparation

### `P-01` Preview an invitation

- **User goal:** Decide whether the invitation is expected before signing in.
- **Primary action:** `Join event`.
- **System result:** A universal link opens a safe preview containing only root
  title, cover, approximate dates, organizer display name, intended role, and
  invite availability. The token is not logged or placed in analytics.
- **States and recovery:** Loading may use a safe skeleton, never stale private
  event data. Offline preserves the link and offers `Try when online`. Expired,
  revoked, exhausted, or malformed links explain that no membership was created
  and offer `Ask organizer`.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, and `LINK` cover cold/warm
  open, token redaction, every unavailable state, and no private-data leak.

### `P-02` Establish identity

- **User goal:** Sign in without losing the invitation.
- **Primary action:** `Continue with email`.
- **System result:** User service establishes or resumes a first-party session;
  after authentication the app returns to the preserved invite route.
- **States and recovery:** Loading is cancellable and does not consume the
  invite. Offline keeps the email and return route but does not claim sign-in.
  An email-bound mismatch offers `Use invited email`. Expired magic link offers
  `Send a new link`.
- **Acceptance evidence:** `DEVICE`, `API`, and `LINK` prove return routing,
  short-lived access tokens, refresh rotation, and no raw member UUID session.

### `P-03` Redeem the root invitation

- **User goal:** Join once with the promised role.
- **Primary action:** `Accept invitation`.
- **System result:** Event service atomically consumes one allowed use and
  upserts root membership for the authenticated user. Replaying the same invite
  for that user returns the same membership result.
- **States and recovery:** Concurrent final-use loss, revocation, removal, or
  email mismatch creates no membership and offers `Ask organizer`. A timeout
  offers `Check membership`; the app reads before retrying so an unknown result
  cannot create duplicate membership.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `LINK` prove idempotent
  redemption, concurrent exhaustion, and correct participant/viewer rights.

### `P-04` Make the root available offline

- **User goal:** Enter the event and trust that essential content will remain
  available.
- **Primary action:** `Open event`.
- **System result:** The initial snapshot populates SQLite with the published
  tree, itinerary, membership, feed window, action state, place snapshots, and
  sync cursor before the root is marked available offline.
- **States and recovery:** First sync shows bounded progress and can resume. A
  partial or cursor-expired result never appears as complete and offers
  `Download again`. Storage pressure explains the required space. If connection
  drops, already-verified chunks remain resumable.
- **Acceptance evidence:** `DEVICE`, `API`, and `OFFLINE` prove an interrupted
  download resumes and an airplane-mode reopen renders one coherent root.

### `P-05` Complete the next personal action

- **User goal:** See the one thing requiring attention instead of scanning the
  entire plan.
- **Primary action:** `Complete next action`.
- **System result:** The app opens the highest-priority permitted request, such
  as attendance, dietary/accessibility needs, handicap, arrival details, team
  preference, or acknowledgment. Completion writes only the participant's
  allowed contribution and advances the action list.
- **States and recovery:** With no pending action, the event says `You're ready`
  and the primary action becomes `View plan`. Offline completion queues. A
  request withdrawn or changed by an organizer preserves entered text and
  offers `Review updated request`; a removed member cannot submit it.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, and `OFFLINE` prove
  participant-only ownership, queued completion, and no organizer-only fields.

## Turkey golf-tour variant

These steps specialize the shared journey; they do not replace it.

### `G-O-01` Plan travel, stay, and transfers

- **User goal:** Turn the tour into an understandable door-to-door itinerary.
- **Primary action:** `Add travel item`.
- **System result:** Flight, lodging, road-transfer, meal, and note items are
  placed under the relevant day with UTC instants, display zones, immutable
  place snapshots, and optional enriched place references.
- **States and recovery:** An empty day suggests a travel item. Place enrichment
  may remain `Finding details`; name, locality, and time are still publishable.
  Provider error offers `Enter manually`. Offline additions queue. Concurrent
  item edits offer `Review changes`.
- **Acceptance evidence:** `FIXTURE-GOLF`, `DEVICE`, `API`, and `OFFLINE` prove
  origin/destination time zones, pending enrichment, manual fallback, and
  readable cached snapshots.

### `G-O-02` Add golf rounds

- **User goal:** Publish course, tee time, format, and scoring setup for each
  round.
- **Primary action:** `Add round`.
- **System result:** A golf descendant/capability and `golf_round` itinerary
  item are created with course reference, scoring schema, and participant
  eligibility. Course discovery runs asynchronously when no local candidate is
  suitable.
- **States and recovery:** Empty search offers `Add course manually`. Enrichment
  loading never blocks draft work. Offline uses cached/manual course details.
  Changing scoring after scores exist offers `Review impact`; deleting a live
  round requires resolving dependent scores.
- **Acceptance evidence:** `FIXTURE-GOLF`, `DEVICE`, `API`, and `DB` prove nested
  rounds, dependency protection, asynchronous enrichment, and no provider call
  in the gateway request path.

### `G-O-03` Publish a tour change

- **User goal:** Tell travelers what changed without creating a separate chat
  message.
- **Primary action:** `Publish update`.
- **System result:** The itinerary mutation and feed-visible domain event share
  a root revision; affected members receive a deep-linkable notification after
  the transaction commits.
- **States and recovery:** Offline edit queues but notification remains pending.
  If another organizer changed the same item, `Review changes` precedes
  publication. Provider delivery failure leaves the change published and the
  outbox retry visible to operations, not as a false app failure.
- **Acceptance evidence:** `FIXTURE-GOLF`, `API`, `DB`, `OFFLINE`, and `LINK`
  prove atomic content/feed change and idempotent notification retry.

### `G-P-01` Prepare for the tour

- **User goal:** Supply only personal details needed for travel and golf.
- **Primary action:** `Complete trip details`.
- **System result:** The participant records allowed arrival, dietary,
  accessibility, and handicap information; the action center reflects what is
  complete without exposing another person's details.
- **States and recovery:** Empty optional fields are allowed. Validation is
  local and server-confirmed. Offline submit queues. A request changed while
  offline offers `Review request`; stale sensitive values are not copied into a
  public feed entry.
- **Acceptance evidence:** `FIXTURE-GOLF`, `DEVICE`, `A11Y`, `API`, and
  `OFFLINE` prove field ownership, privacy, partial completion, and reconnect.

### `G-P-02` Follow the live travel plan

- **User goal:** Know where to be now and next even with poor connectivity.
- **Primary action:** `Open next item`.
- **System result:** The cached chronological plan opens the current/next
  flight, transfer, hotel, meal, or round with local time, place snapshot,
  instructions, and last-sync state.
- **States and recovery:** No current item falls back to the next scheduled item
  or `View full plan`. Refresh loading does not cover cached content. Offline
  keeps directions text and critical notes available. A cancelled/tombstoned
  item is removed with a feed update; an already-open item explains the change
  and offers `View updated plan`.
- **Acceptance evidence:** `FIXTURE-GOLF`, `DEVICE`, `A11Y`, `OFFLINE`, and
  `LINK` prove time zones, cached reopening, push deep link, and tombstone
  handling.

### `G-P-03` Enter a round score

- **User goal:** Record the current hole reliably on the course.
- **Primary action:** `Save hole`.
- **System result:** Strokes for the participant and hole are validated,
  calculated locally for immediate feedback, stored in SQLite, and queued with
  stable entity/mutation IDs. Server confirmation produces the authoritative
  score and leaderboard revision.
- **States and recovery:** An empty scorecard starts at the first incomplete
  hole. Offline scoring remains fully usable and visibly queued. Duplicate
  delivery is idempotent. A concurrent score edit offers `Review score`, showing
  local and server values; neither is discarded until resolved.
- **Acceptance evidence:** `FIXTURE-GOLF`, `DEVICE`, `A11Y`, `API`, `DB`, and
  `OFFLINE` cover 18-hole airplane-mode entry, process restart, reconnect,
  duplicate delivery, and one deliberate score conflict.

## Non-travel team-event variant

### `T-O-01` Build agenda and activities

- **User goal:** Turn an offsite into sessions and activities without trip or
  golf concepts.
- **Primary action:** `Add agenda item`.
- **System result:** Session/activity descendants and itinerary items receive
  times, rooms or venue snapshots, facilitators when enabled, and stable order
  beneath the team-event root.
- **States and recovery:** An empty agenda suggests a session or activity, not a
  flight or round. Place search has manual fallback. Offline edits queue. A
  concurrent reorder offers `Review order`; an invalid parent preserves the
  draft and offers `Choose another section`.
- **Acceptance evidence:** `FIXTURE-TEAM`, `DEVICE`, `API`, `DB`, and `OFFLINE`
  prove nesting, ordering, and absence of travel/golf requirements or labels.

### `T-O-02` Assign teams and open a decision

- **User goal:** Prepare collaboration without exposing organizer controls to
  participants.
- **Primary action:** `Publish assignments`.
- **System result:** Team capability records assign participants according to
  configured capacity, and a feed-visible decision/vote can target the relevant
  session. Viewers remain read-only.
- **States and recovery:** No eligible participants explains whom to invite.
  Capacity validation identifies the affected team. Offline draft assignments
  queue but are not presented as published. A concurrent assignment edit offers
  `Review assignments`.
- **Acceptance evidence:** `FIXTURE-TEAM`, `DEVICE`, `API`, `DB`, and `OFFLINE`
  prove participant isolation, capacity rules, one publication revision, and
  role-correct controls.

### `T-O-03` Change the live agenda

- **User goal:** Move or cancel a session and alert everyone once.
- **Primary action:** `Publish update`.
- **System result:** The item version, root change, feed event, and notification
  outbox entry commit atomically. The deep link resolves to the updated item.
- **States and recovery:** Offline changes queue and are labeled unpublished. A
  conflict offers `Review changes`. Notification-provider failure does not roll
  back the agenda and is retried by the worker.
- **Acceptance evidence:** `FIXTURE-TEAM`, `API`, `DB`, `OFFLINE`, and `LINK`
  prove one domain revision, no duplicate update, and correct warm/cold routing.

### `T-P-01` Prepare for the event

- **User goal:** Confirm attendance and relevant team-event needs.
- **Primary action:** `Complete event details`.
- **System result:** The participant records permitted attendance,
  dietary/accessibility needs, and requested preferences; the app shows any
  published team assignment without exposing organizer controls.
- **States and recovery:** No request yields `You're ready`. Offline completion
  queues. A changed request offers `Review request`; removal locks cached event
  data and prevents submission after authorization refresh.
- **Acceptance evidence:** `FIXTURE-TEAM`, `DEVICE`, `A11Y`, `API`, and
  `OFFLINE` prove private contributions, no sport fields, and deterministic
  reconnect.

### `T-P-02` Follow the live agenda

- **User goal:** Find the current session, room, team, and next transition.
- **Primary action:** `Open current session`.
- **System result:** The app resolves now/next from cached local time and opens
  the descendant session or activity, including its place snapshot and relevant
  feed thread.
- **States and recovery:** Before the first session it offers `View first item`;
  after the last, `View recap` when available. Offline uses cached content.
  Cancelled or moved items explain the update and offer `View updated agenda`.
- **Acceptance evidence:** `FIXTURE-TEAM`, `DEVICE`, `A11Y`, `OFFLINE`, and
  `LINK` prove now/next, deep links, last-sync context, and tombstones.

### `T-P-03` Respond to a live decision

- **User goal:** Vote or acknowledge once without leaving the session context.
- **Primary action:** `Submit response`.
- **System result:** An idempotent participant contribution is stored locally,
  queued if needed, and reflected optimistically; server confirmation supplies
  the authoritative aggregate permitted for that decision.
- **States and recovery:** No open decision shows its closed outcome. Offline
  response queues. Closing while the response is queued returns a rejected
  result that preserves the choice and offers `View outcome`; a conflicting
  mutable response offers `Review response`.
- **Acceptance evidence:** `FIXTURE-TEAM`, `DEVICE`, `API`, `DB`, and `OFFLINE`
  prove one response per policy, duplicate delivery, close/reconnect behavior,
  and viewer read-only behavior.

## Shared communication journey

### `C-01` Read an update in context

- **User goal:** Understand what changed and where it belongs.
- **Primary action:** `View update`.
- **System result:** A feed or push deep link opens the root and, when present,
  its descendant event or itinerary item. Auth and membership are checked before
  private content appears.
- **States and recovery:** Empty feed explains that plan changes also appear
  here. Cached feed opens offline with last-sync context. A deleted target opens
  its tombstone explanation. Signed-out flow returns to the link after auth;
  unauthorized access reveals no event details.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `LINK`, `API`, and `OFFLINE` cover
  root/item links, signed-out return, cached open, removal, and concealed roots.

### `C-02` Post to the event feed

- **User goal:** Share a message or photo with the crew.
- **Primary action:** `Post update`.
- **System result:** Owner, organizer, or participant creates an append-only feed
  entry with a client ID and mutation ID. Text appears locally; a photo remains
  `Uploading` until its two-phase object upload and feed mutation finish.
- **States and recovery:** Empty composer does not submit. Offline text and local
  photo references queue without claiming delivery. Missing local media offers
  `Choose photo again`. Retry is idempotent; viewers have no composer.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, `DB`, and `OFFLINE` prove
  process-restart persistence, duplicate retry, attachment recovery, and role
  enforcement.

### `C-03` React, revise, or moderate

- **User goal:** Respond safely or correct a contribution.
- **Primary action:** `Save change`.
- **System result:** Reactions merge idempotently. Editing creates a feed
  revision; author removal or organizer moderation creates a tombstone. Original
  identity and chronology remain auditable.
- **States and recovery:** Offline permitted reactions/edits queue. A stale edit
  offers `Review changes`. If the entry was moderated or membership was removed,
  local text remains recoverable but cannot overwrite the tombstone. Viewer sees
  no write controls.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `OFFLINE` prove reaction
  dedupe, revision history, author versus moderator permission, and tombstones.

## Shared offline recovery and conflict journey

### `S-01` Continue during connection loss

- **User goal:** Keep using an already-synced event without guessing what is
  current.
- **Primary action:** `Continue offline`.
- **System result:** Cached root data remains interactive within cached
  permissions. A persistent, non-color-only state gives the last successful
  sync time and pending count without obscuring content.
- **States and recovery:** A root never synced on this device cannot be opened
  privately and offers `Reconnect`. Token expiry does not erase local data, but
  server-bound actions wait for re-authentication. Sensitive content follows the
  device lock and removal policy.
- **Acceptance evidence:** `DEVICE`, `A11Y`, and `OFFLINE` prove cold reopen,
  process restart, clock/time-zone clarity, and no false fresh state.

### `S-02` Save a permitted offline change

- **User goal:** Finish work without waiting for a signal.
- **Primary action:** `Save`.
- **System result:** SQLite updates transactionally with an outbox record,
  observed base version, client entity ID, mutation ID, root ID, and dependency
  order. The affected content shows `Queued`.
- **States and recovery:** Local validation blocks malformed data before queueing.
  Storage or encryption failure keeps the editor open and offers `Try again`;
  the app never clears fields before the local transaction commits.
- **Acceptance evidence:** `DEVICE`, `SQLITE`, and `OFFLINE` prove crash-safe local
  commit, dependency order, and preservation after force-quit.

### `S-03` Recover a stalled upload

- **User goal:** Understand why a queued change did not finish.
- **Primary action:** `Retry now`.
- **System result:** Reconnect normally pushes and pulls automatically. Manual
  retry is shown only after bounded backoff or a recoverable failure; duplicate
  mutation IDs return the original result.
- **States and recovery:** Auth expiry routes through sign-in and resumes the
  queue. Provider or gateway outage keeps the item queued. Permanent validation
  failure becomes `Needs attention` with editable data; it never loops forever
  or blocks unrelated mutations.
- **Acceptance evidence:** `API`, `DB`, and `OFFLINE` cover automatic reconnect,
  exponential retry, token refresh, duplicate delivery, restart, and isolated
  dead-letter behavior.

### `S-04` Review a version conflict

- **User goal:** See exactly what changed before choosing a result.
- **Primary action:** `Review conflict`.
- **System result:** The conflict view names the entity and fields, shows the
  preserved local version beside the authorized server version, and states who
  can resolve it. Unrelated sync continues.
- **States and recovery:** If the server entity is tombstoned, the local content
  is read-only and copyable. If access was removed, server content is concealed
  and only the person's local draft is exportable. Failure to load the current
  version offers `Try again` without deleting the local version.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `API`, and `OFFLINE` prove stale
  update, tombstone, removed-member, and no-data-loss cases.

### `S-05` Resolve the conflict

- **User goal:** Apply one informed outcome and finish syncing.
- **Primary action:** `Apply resolution`.
- **System result:** The chosen local, server, or manually combined value is sent
  as a new versioned mutation against the current base. Success clears only that
  conflict and retains an auditable revision.
- **States and recovery:** A second conflict reopens with both latest versions.
  Offline resolution remains a local draft and is not labeled resolved. Lacking
  permission allows `Keep local copy` but not a server overwrite.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `OFFLINE` prove both-choice
  resolution, repeated race, audit revision, and permission downgrade.

## Shared product-feedback journey

Product feedback belongs to Crew, not to an event role. Any signed-in user may
submit it; optional root/screen/build diagnostics are attached only with clear
scope and screenshot consent. Secrets and unnecessary personal data are
redacted before the outbox write. Community browsing is a separate, sanitized
root-scoped projection: only active members of that root can list, read, vote,
comment on, or follow canonical public items. It contains no author identity,
diagnostics, attachments, or context IDs; following one item does not create a
person, event, or cross-root social relationship.

### `F-01` Start contextual feedback

- **User goal:** Report an idea or problem without abandoning the current task.
- **Primary action:** `Give feedback`.
- **System result:** A feedback draft records the current app/build and a bounded
  route/root reference. Screenshot and diagnostics are opt-in and previewable.
- **States and recovery:** Entry works from any core flow. Offline opens the same
  form. Screenshot failure leaves text submission available. No event membership
  details or tokens are included by default.
- **Acceptance evidence:** `DEVICE`, `A11Y`, and `OFFLINE` prove return-to-flow,
  consent, redacted payload preview, and offline availability.

### `F-02` Find duplicates and submit

- **User goal:** Add signal to an existing idea or create a clear new report.
- **Primary action:** `Submit feedback`.
- **System result:** Online title/body entry may show likely duplicates; choosing
  one can add a vote/comment, while a new feedback item receives stable identity,
  visibility, delivery state, and public status. Suggestions use a deterministic
  same-root Unicode token match; they are not semantic or fuzzy similarity.
- **States and recovery:** No duplicates keeps the new submission path. Search
  loading never blocks writing. Offline skips live duplicate search and queues
  submission. Attachment upload error preserves text and offers later retry.
- **Acceptance evidence:** `DEVICE`, `API`, `DB`, and `OFFLINE` prove duplicate
  suggestion, new item, vote dedupe, queued attachment, and no core-flow block.

### `F-03` Follow the community loop

- **User goal:** See whether feedback is understood and contribute once more.
- **Primary action:** `View feedback update`.
- **System result:** After active root membership succeeds, a deep link opens
  the sanitized canonical feedback item, event-visible status history, votes, follow
  state, and permitted comments. The current API/SQLite controller supports
  online contributions and account-/root-isolated cached reads; visible
  queued/synced semantics for offline contributions remain target behavior.
- **States and recovery:** Empty comments explain the current status rather than
  demanding a post. Offline cached items remain readable; the UI must not claim
  a queued contribution until the offline-write gate is implemented. Merged
  duplicates redirect to the canonical item; removed membership or unavailable
  items return a safe concealed state.
- **Acceptance evidence:** `DEVICE`, `A11Y`, `LINK`, `API`, and `OFFLINE` prove
  canonical redirect, status history, vote dedupe, comments, and privacy.

## Shared recap journey

A root becoming past is derived from its end time; publishing a recap does not
silently archive the root. Owner-only archive remains a separate lifecycle
action.

### `R-O-01` Review generated highlights

- **User goal:** Check the event story before participants see it.
- **Primary action:** Current empty manager state `Create draft`; generated draft
  `Publish for the crew` after review.
- **System result:** Owner or organizer requests an immutable draft from
  published itinerary outcomes, feed/media, golf results, or team decisions.
  Source facts remain linked; generated copy is never treated as authoritative
  domain data. Manual highlight editing remains a planned contract.
- **States and recovery:** Generation requires a confirmed online Gateway
  response and is never queued. Failure leaves the event and source media
  intact and offers `Try again`. An authorized cached draft stays readable
  offline, while the only write recovery is `Check online`.
- **Acceptance evidence:** Current iPhone 16e visual/controller evidence proves
  generated draft review, online-only commands, account/root cache isolation,
  role reduction, and near-200% text. Real service-backed recovery on both
  platforms and manual highlight editing remain required for a broader claim.

### `R-O-02` Publish the recap

- **User goal:** Release one accurate, privacy-respecting recap.
- **Primary action:** `Publish recap`.
- **System result:** Owner or organizer publishes a versioned recap. The current
  backend can then create or rotate one seven-day opaque link bound to that exact
  published version and revoke it immediately. The title-only resolver returns
  only recap/item titles. A separate exact-field resolver may return explicitly
  selected approved bodies and, behind a server-default-off privacy/legal gate,
  caption strings. Attachment bytes, media URLs, provenance, identities,
  source/root/attachment IDs, and lifecycle metadata are absent. Design-2 shows
  each exact body/caption separately; caption copy says that the description,
  not the image, is shared. The manager route creates a link only after a
  successful online response, opens the platform share sheet, supports re-share,
  and revokes it.
- **States and recovery:** Invalid or removed generated sources fail closed.
  Publication, removal, link creation, and revocation are online-only and never
  queued. Share-sheet cancellation returns to the reviewed recap; a launch
  failure keeps only the current in-memory active link for retry or revoke.
- **Acceptance evidence:** Current `API`, `DB`, `LINK`, iPhone `DEVICE`, `A11Y`,
  authorized `OFFLINE`, and native share evidence prove exact-version binding,
  token non-persistence, bounded expiry, rotation/revocation, role-safe controls,
  and generic concealment for title/body flows. Caption backend, MobileData and
  focused native render tests prove opaque-ref binding, ephemeral storage and
  text-only controls; caption device evidence, privacy/legal approval, a
  deployed public consumer and real service-backed both-platform recovery remain
  release gates.

### `R-P-01` Revisit the event

- **User goal:** See the final plan, outcomes, people-safe highlights, and media.
- **Primary action:** `View recap`.
- **System result:** The membership-gated published recap may adapt by
  capability: golf rounds and leaderboard for the tour; sessions, decisions,
  and team outcomes for the offsite. Participants do not create external links
  in the current contract. A manager-issued title link resolves separately to
  title and titled items only; an exact-field link is a separately reviewed body
  or caption-text selection. Caption release remains disabled by default.
- **States and recovery:** Before publication, the past event remains accessible
  and explains that the recap is pending. Cached recap is readable offline;
  manager link operations and public resolution wait for a connection. Every
  unavailable public token shows only `This content is unavailable` and
  `Close`; it never names the cause. Removed media disappears from the member
  view through tombstones; unavailable recap never blocks source feed or
  itinerary access.
- **Acceptance evidence:** Current iPhone `DEVICE`, `A11Y`, and authorized
  `OFFLINE` evidence prove a published-only participant/member view and no
  share control. Golf/team capability-specific published variants, Android
  visual parity, and real service-backed both-platform recovery remain required.
  Current `LINK` evidence proves only the manager-owned title-only public
  contract; participant link creation is not allowed by the current
  [external recap consent policy](./external-recap-consent-policy.md) or contract.

## Cross-flow state matrix

Each cell names the one primary recovery action for that state. `—` means the
state is not valid, not that the app may ignore it.

| Flow                  | Empty                                             | Loading / refresh                              | Error                                                    | Offline                                                                | Conflict                                                           | Permission or removal                                                          |
| --------------------- | ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Event list / create   | `Create event`                                    | Show cached list; `Wait` only on first install | `Try again`                                              | `Create offline draft`                                                 | `Review draft`                                                     | Conceal inaccessible roots; `Contact organizer`                                |
| Draft plan            | `Add to plan`                                     | Keep cached draft; no blocking refresh         | `Try again` with fields intact                           | `Save` queues                                                          | `Review changes` or `Review order`                                 | Hide write controls; `Keep local copy` after downgrade                         |
| Invite / join         | `Ask organizer` when unavailable                  | Safe preview skeleton                          | `Try again` or `Ask organizer` for terminal invite state | `Try when online`                                                      | Concurrent last use: `Ask organizer`                               | Concealed root; `Use invited email` only for binding mismatch                  |
| Initial root sync     | `Open event` after complete snapshot              | Bounded resumable progress                     | `Download again`                                         | `Reconnect`                                                            | Snapshot supersedes partial local read model only after validation | Lock private cache after confirmed removal; `Contact organizer`                |
| Personal actions      | `View plan`                                       | Keep cached action state                       | `Try again` with input intact                            | `Save` queues                                                          | `Review updated request`                                           | Remove composer; `Keep local copy` for rejected draft                          |
| Itinerary / live item | `View full plan`                                  | Keep cached now/next                           | `Try again` without hiding plan                          | `Open next item` from cache                                            | `Review changes` for editors                                       | Read-only for viewer; tombstone offers `View updated plan`                     |
| Feed text / reaction  | `Post first update` for writers                   | Keep cached feed                               | `Retry now`                                              | `Post update` queues                                                   | `Review changes` for mutable edit                                  | Viewer has no composer; moderated text offers `Keep local copy`                |
| Media attachment      | `Choose photo`                                    | Show local preview and `Uploading`             | `Choose photo again` if local file is gone               | `Post update` queues local reference                                   | Tombstone wins; `Keep local copy`                                  | No upload control when read-only                                               |
| Golf score            | `Start scorecard`                                 | Keep local holes visible                       | `Retry now`                                              | `Save hole` queues                                                     | `Review score`                                                     | Non-player/viewer is read-only; `Contact organizer` for setup issue            |
| Team response         | `View outcome` when closed                        | Keep local choice visible                      | `Retry now`                                              | `Submit response` queues                                               | `Review response`                                                  | Viewer is read-only; closed decision offers `View outcome`                     |
| Product feedback      | `Give feedback`                                   | Duplicate search does not block typing         | `Try again` with draft intact                            | `Submit feedback` queues                                               | Merged duplicate: `View canonical item`                            | Item unavailable: `View event feedback`; root unavailable: safe terminal       |
| Recap                 | Current manager `Create draft`; participant waits | Keep source event usable                       | `Try again` without affecting source data                | Read authorized draft/published cache; `Check online`; no write queues | Manual-edit conflict remains planned                               | Member removal conceals recap; every public-link failure is generic and closes |

## Deep-link contract

The screen inventory must include cold, warm, signed-out, offline, and denied
states for these link families:

| Link target                        | Resolution rule                                                                                                                                                  | Safe fallback                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation token                   | Public safe preview, then identity, then atomic redemption                                                                                                       | Expired/revoked/exhausted reveals no private root data and offers organizer contact                                                                                         |
| Root event                         | Verify session and root membership before rendering                                                                                                              | Signed-out returns after auth; non-member gets concealed not-found state                                                                                                    |
| Descendant event or itinerary item | Open root first, apply pending changes, then resolve target                                                                                                      | Tombstone explains update and routes to current plan                                                                                                                        |
| Feed entry or notification         | Resolve root and optional descendant context                                                                                                                     | Moderated/deleted entry routes to feed with an unavailable explanation                                                                                                      |
| Feedback item                      | Verify active root membership, then resolve sanitized visibility and canonical duplicate                                                                         | Merged item redirects; unavailable item routes to event feedback only while the root remains authorized                                                                     |
| Recap                              | Verify membership for the full recap, or resolve the opaque public token online against the exact current published version and all current policy/source checks | Pending member recap routes to the past event. Every unavailable public token shows the same content-unavailable fallback with `Close`; no cause or event data is revealed. |

Invite tokens, access tokens, private feedback IDs, and participant-sensitive
values must not enter analytics, notification previews, crash logs, or clipboard
history controlled by the app.

## Accessibility requirements

These requirements apply to every journey and become mandatory states in the
screen inventory:

- Every primary action has a unique accessible name and remains reachable at
  large text sizes without obscuring validation or sync state.
- Reading and focus order follows user intent: context, state, content, primary
  action. Opening a deep link or validation error moves focus to the new heading
  or first invalid field.
- Offline, queued, failed, conflict, cancelled, and completed states use text and
  semantics in addition to color or animation. Screen readers announce a change
  once, not on every retry.
- Dates announce local day, time, and zone when ambiguity matters. Overnight and
  cross-zone travel is not expressed by color or horizontal position alone.
- Recursive plans expose heading level, parent context, expanded state, and
  sibling position without relying on indentation alone.
- Conflict comparison is navigable by field and labels local versus server
  value; resolution never depends on side-by-side vision.
- Golf score entry identifies hole, par, player, current value, validation, and
  save result. It is operable with screen reader, switch control, and large text.
- Images require useful captions or are marked decorative. Screenshot feedback
  consent describes exactly what will be attached.
- Touch targets meet native platform minimums; gestures have visible alternatives;
  reduced-motion settings remove nonessential transitions without hiding state.
- Authentication, invitation, and permission errors use plain language and do
  not reveal whether a concealed root or user exists.

## Inputs for the Figma-ready screen inventory

The screen inventory maps these journey steps to functional surface families;
all resulting frames inherit Option 2 / Crew Board from the binding handoff:

| Surface family                      | Journey sources                                     | Required variants                                                                                 |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Event list and create flow          | `O-01`–`O-03`                                       | no events, cached events, offline draft, create error, root conflict                              |
| Event hub and action center         | `P-04`, `P-05`, `G-P-02`, `T-P-02`                  | organizer/participant/viewer, now/next, ready, queued, removed                                    |
| Plan tree and item editor           | `O-04`–`O-06`, `G-O-01`–`G-O-03`, `T-O-01`–`T-O-03` | empty, nested, manual place, enrichment pending, offline, reorder/edit conflict                   |
| Invite manager and join             | `O-07`, `O-08`, `P-01`–`P-03`                       | valid, signed-out, email-bound, expired, revoked, exhausted, offline, owner/organizer permissions |
| Personal-action form                | `P-05`, `G-P-01`, `T-P-01`                          | partial, complete, validation, queued, request changed, permission removed                        |
| Live item                           | `G-P-02`, `T-P-02`                                  | upcoming/current/past, moved, cancelled, offline, deep-linked                                     |
| Golf scorecard                      | `G-P-03`                                            | untouched, partial, queued, synced, invalid, conflict, read-only                                  |
| Team decision                       | `T-O-02`, `T-P-03`                                  | draft/open/closed, empty, queued response, conflict, viewer                                       |
| Feed, composer, and media           | `C-01`–`C-03`                                       | empty, cached, queued, uploading, failed media, revised, moderated, viewer                        |
| Sync status and conflict resolution | `S-01`–`S-05`                                       | offline, retrying, auth paused, needs attention, compare, tombstone, removed access, resolved     |
| Feedback                            | `F-01`–`F-03`                                       | consent, duplicate search, no match, queued, attachment retry, merged, private/removed            |
| Recap                               | `R-O-01`–`R-P-01`                                   | generating, empty, draft, conflict, published, cached, privacy-filtered, share unavailable        |

Each inventory entry still needs its own route, entry/exit transition, required
API/read-model data, dimensions, and selected visual language. This document
intentionally supplies behavior and state coverage only.

## End-to-end acceptance paths

### Turkey golf tour

1. Owner completes `O-01` through `O-08` with the Turkey setup.
2. Participant completes `P-01` through `P-05` and `G-P-01`.
3. Organizer completes `G-O-01` through `G-O-03`; participant opens the changed
   plan through `C-01` and `G-P-02`.
4. Participant completes all of `G-P-03` in airplane mode, posts one photo via
   `C-02`, reconnects through `S-03`, and resolves one deliberate conflict via
   `S-04` and `S-05`.
5. Participant submits feedback through `F-01`–`F-03`; organizer publishes and
   participant opens the recap through `R-O-01`–`R-P-01`.

The path passes only with no duplicate root, membership, score, feed entry,
attachment, vote, or notification; no lost local data; and no service or legacy
URL in mobile traffic.

### Non-travel team event

1. Owner completes `O-01` through `O-08` with the team-event setup.
2. Participant completes `P-01` through `P-05` and `T-P-01` without seeing a
   travel, package, golf, or scoring requirement.
3. Organizer completes `T-O-01` through `T-O-03`; participant follows the deep
   link through `C-01` and `T-P-02`.
4. Participant completes `T-P-03` and `C-02` offline, reconnects through `S-03`,
   and sees a decision closed during the outage without losing the local choice.
5. Participant submits feedback and both roles complete the recap journey.

The path passes only when core service code branches on attached capabilities,
not on sport-specific assumptions, and role/offline behavior matches the golf
path.
