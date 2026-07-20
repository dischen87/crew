# Option 2 feedback compose handoff

- Screen: `SCR-060`
- Overlay: `OVR-013`
- Beads: `crew-paq.6.3.1`, `crew-paq.6.2.2`
- Visual direction: Option 2 / Crew Board only

## Product contract

Text feedback remains the default and works without screenshot support. A
screenshot originates only from a visible, explicit action on the source
screen. Opening Compose must never capture automatically, and Compose must not
capture itself.

The source action calls `FeedbackComposeRuntime.capture(rootEventId)` while the
source screen is still active. Capture validates account, root and generated
identities before native media access, retains the bounded PNG privately, and
returns a `feedbackId`. Navigation may carry only that `feedbackId` plus the
existing bounded source context. It must never carry the preview data URI,
retained file key, attachment ID, checksum, local path, bytes, native error or
upload grant.

Compose restores the account/root-bound draft, keeps the bounded preview only
in React state, and starts with `Screenshot mitsenden` unchecked. Its single
primary action says either `Text ohne Screenshot senden` or
`Feedback mit Screenshot senden`, so omission is explicit. Removing, cancelling
or leaving an unsubmitted draft discards its durable binding and reconciles the
private file. Cleanup waits for an in-flight enqueue: a successful enqueue owns
the screenshot; a failed enqueue is cleaned afterward.

If screenshot delivery reaches terminal attention before feedback delivery,
`Ohne Screenshot senden` is the sole primary recovery. It marks the durable
screenshot choice omitted and resumes the same feedback identity. Pending,
sending, attention and delivered copy never claims server delivery early.

## Implemented source and route boundary

The shared navigation boundary now is:

```ts
FeedbackCompose: {
  eventId?: string | null;
  feedbackId?: string | null;
  rootEventId?: string | null;
  screenKey: string;
  sourceLabel: string;
};
```

Source screens must pass enum-like `screenKey` values matching
`[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}` and a human label of at most 120 Unicode
characters without control characters. Compose enforces these bounds again.
`eventId` is accepted only with a valid `rootEventId`; malformed event/root or
feedback IDs degrade to private text-only feedback and cannot reach restore,
capture or event visibility.

Recommended source controls:

- First integration is limited to `CommunityFeedbackList`; other core screens
  stay text-only until they receive their own reviewed source action.
- Existing `Feedback geben` opens text-only Compose without `feedbackId`.
- Secondary `Screenshot hinzufügen` performs the explicit source capture and
  navigates only after durable retention succeeds.
- Capture failure stays non-sensitive and offers text-only Compose.
- If the source action is cancelled after capture but before navigation, call
  `runtime.cleanup(feedbackId)`.

`CommunityFeedbackList` implements that first integration. The existing
`Feedback geben` callback is unchanged and remains usable while capture is in
progress. Its separate Option-2 secondary action, `Screenshot hinzufügen`,
deduplicates double taps, captures while the list is visible, and hands only the
returned `feedbackId` to the route wrapper. Capture failure, navigation abort,
text-only selection, account/root change and unmount clean the source-owned
draft without exposing native details. The route wrapper passes the bounded
params as `source`; no preview, attachment identity, checksum, retained key or
path belongs in `FeedbackRoutes.tsx`.

## Duplicate suggestion integration

For event-visible drafts, Compose searches with at most twelve Unicode NFKC
tokens from the title. The body is used only when the title cannot form a valid
query, because the backend deliberately AND-matches every supplied token. The
generated `eventFeedbackDuplicateSuggestionsList` read is debounced; loading,
failure, rate limiting and concealment never disable writing or submission.
Private and rootless feedback never searches event content.

SQLite stores only `id`, `title`, `status` and `voteCount` under the exact
account, root and a SHA-256 query fingerprint. It retains at most twenty recent
query fingerprints per account/root and never stores the query text, draft
body, author, diagnostics, attachments, context, comments or duplicate links.
Cached results are offered offline only while the same account has a locally
active membership in that root. Denied roots purge their cache; root/account
purge cascades through `root_sync_state`.

Cached cards say `LETZTER ONLINE-STAND`. Selection invokes the route-owned
`onOpenDuplicateSuggestion(feedbackId)` callback. `SCR-061` then resolves a
later merge to its canonical item and conceals private, removed or unavailable
items. Compose itself contains no navigation dependency.

## Offline delivery integration

`FeedbackComposeRuntime` injects the native attachment upload transport for
delivery while Compose is active. The shared `FeedbackDeliveryPump` now receives
the same `createFeedbackAttachmentUploadTransport()` option, so a screenshot
queued offline can resume after Compose closes instead of reaching the global
pump without an upload transport.

## Figma-ready states

- Text only: no screenshot card; primary `Feedback senden`.
- Duplicate search: non-blocking `WIRD GEPRÜFT`, sanitized online results,
  honest cached results, generic retry, or offline-skipped copy; submit remains
  the sole primary action.
- Preview loading: bounded status card; submit waits, text remains intact.
- Preview ready, unchecked: actual source thumbnail, explicit consent unchecked,
  primary `Text ohne Screenshot senden`.
- Preview ready, checked: selected semantics and primary
  `Feedback mit Screenshot senden`.
- Preview unavailable: safe text-only notice, no raw cause, primary
  `Feedback senden`.
- Attachment attention: one primary `Ohne Screenshot senden`.
- Queued/sending/delivered: copy states whether the selected screenshot is part
  of the durable submission.

All controls use the existing Crew Board primitives, grow vertically at Large
Text, retain 48-point targets and remain scrollable at 390 x 844.

## Evidence gate

Code-level focused tests cover consent default-off, explicit omission,
account/root guards, malformed route context, late preview suppression,
submit/unmount cleanup ordering, the one-primary attention recovery, explicit
source capture, double taps, text-only cancellation, account/source/unmount
races, navigation abort cleanup, bounded routing and global pump transport
injection. Native 390 x 844 and Large Text captures, unique source-content
comparison, iOS/Android success/failure, restart and real offline pump evidence
remain for the coordinated shared code freeze.
