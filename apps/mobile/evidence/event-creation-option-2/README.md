# Event creation — Option 2 / Crew Board

This folder is the native iOS evidence set for `crew-paq.3.5.4` and its
template-identity bug `crew-paq.3.5.4.1`. Option 2 / Crew Board is the only
binding visual direction.

## Proven product boundary

An eligible signed-in organizer can now move through the production navigator:

1. `Events` exposes `Event erstellen` only while private state is ready and the
   account can create a root.
2. `CreateEvent` loads the generated Gateway template projection, or keeps an
   honest blank option when templates are unavailable.
3. The selected template and entered details become one canonical root-create
   command. The command is persisted to encrypted account SQLite before sync,
   with one stable HTTP idempotency key and caller-owned event IDs.
4. The generated `eventsCreate` operation returns the root, bootstrap/pull
   populate the local graph, and navigation lands in `EventHub` by the returned
   `rootEventId`.
5. The new root remains a **private draft**. Owner/organizer sees the single
   `Event prüfen` action; participant/viewer never receives a draft write
   control.

The last action currently opens an honest private-draft status notice. It does
not publish and does not pretend to implement `SCR-013`. The real readiness and
publish journey is tracked separately as `crew-paq.3.5.4.2`.

The release evidence app in
[`event-creation-production-entry.js`](../event-creation-production-entry.js)
uses the normal navigator, generated Gateway client operations, the real
encrypted OP-SQLite adapter, migrations, private bootstrap gate, durable
outbox, and Event Hub. Its controlled transport responds only at the same
Gateway boundaries; it does not bypass production routing or write a service
database directly.

The current P0 Release-crypto rerun is documented separately in
[`release-crypto-proof.md`](./release-crypto-proof.md). On the exact iPhone 16e,
it proves a `crypto.subtle`-absent Event Create, secure injected UUIDv4 IDs,
fallback SHA-256, durable offline persistence, and byte-identical body and HTTP
idempotency fingerprints after a real process restart. The saved proof contains
no raw command, event identifier, idempotency key, token, or credential.

## Visual evidence

Device: iPhone 16e simulator, iOS 26.2, 390 × 844 points. Every primary state
has an untouched 1170 × 2532 physical screenshot and a no-crop 390 × 844
normalization.

| Evidence                                                                                                         | Truth represented                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`00-routed-events-390x844.png`](./00-routed-events-390x844.png)                                                 | Production-routed empty Events index and eligible create action                     |
| [`01-start-choose-390x844.png`](./01-start-choose-390x844.png)                                                   | Step 1 with real Gateway templates and blank setup                                  |
| [`02a-event-details-top-390x844.png`](./02a-event-details-top-390x844.png)                                       | Natural top of the selected team-event details state                                |
| [`02b-event-details-filled-scrolled-390x844.png`](./02b-event-details-filled-scrolled-390x844.png)               | Intentionally scrolled, filled details and reachable submit action                  |
| [`03-created-event-landing-390x844.png`](./03-created-event-landing-390x844.png)                                 | Successful create, sync, and private-draft Event Hub landing                        |
| [`04-templates-offline-390x844.png`](./04-templates-offline-390x844.png)                                         | Template outage, honest retry, and usable blank setup                               |
| [`05-events-error-390x844.png`](./05-events-error-390x844.png)                                                   | Root-list outage with retry as the mint primary action and create as secondary      |
| [`06a-large-text-top-390x844.png`](./06a-large-text-top-390x844.png)                                             | Accessibility Large natural top; text grows without a font cap                      |
| [`06b-large-text-action-scrolled-390x844.png`](./06b-large-text-action-scrolled-390x844.png)                     | Intentionally scrolled Accessibility Large state proving wrapped, reachable actions |
| [`07-private-draft-review-390x844.png`](./07-private-draft-review-390x844.png)                                   | Honest native private-draft review notice; no publish claim                         |
| [`08-release-crypto-offline-enqueued-390x844.png`](./08-release-crypto-offline-enqueued-390x844.png)             | Release-shaped Golf-tour Event Create queued honestly while offline                 |
| [`09-release-crypto-replayed-private-draft-390x844.png`](./09-release-crypto-replayed-private-draft-390x844.png) | Same durable command replayed after process restart into private Event Hub          |

[`design-comparison-source-vs-implementation-780x894.png`](./design-comparison-source-vs-implementation-780x894.png)
places the 390 × 844 binding source and the current 390 × 844 private-draft
landing together. Its header explicitly distinguishes the source's published
example from this milestone's private draft. The comparison is therefore about
the same Crew Board design language, not identical event data or lifecycle
state.

[`qa-contact-sheet-1170x3496.png`](./qa-contact-sheet-1170x3496.png) is a
single-page visual index of the ten implemented states, binding source, and the
source-to-draft comparison. The individual screenshots above remain the
authoritative pixel evidence.

## Native and automated proof

The final Release flow used:

```sh
ENTRY_FILE=evidence/event-creation-production-entry.js xcodebuild \
  -workspace CrewNext.xcworkspace \
  -scheme CrewNext \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3' \
  -derivedDataPath /tmp/crew-creation-evidence.n503Gu build -quiet
```

`maestro-full-create-and-land.yaml` completed all 24 native commands from
Events through template selection, details entry, durable create, sync, and the
unique private-draft Event Hub oracle. The templates-offline, root-list error,
Accessibility Large, private-draft landing, and native review flows also passed
on the same installed Release app.

Current scoped gates:

- `apps/mobile` TypeScript, ESLint, and the final repository-wide 41/41 suites
  with 242/242 tests: pass.
- Event creation, Events, Event Hub, and navigator tests: 45/45 pass.
- `packages/mobile-data`: TypeScript, Biome, and 109/109 tests pass (792
  expectations), including restart replay, exact idempotency, response echo,
  stale-template review, SHA-256 fallback, and identity invariants.
- `packages/mobile-client`: TypeScript, Biome, and 60/60 tests pass (270
  expectations), including generated-artifact parity.
- iOS Release build and native create-to-draft flow: pass.

The focused 2026-07-19 crypto rerun adds: 4/4 Jest suites and 33/33 tests for
Events, Event Create, and navigation; `packages/mobile-data` 137/137 tests with
951 expectations; and two identical sanitized command/idempotency fingerprints
across process restart. This completes the iOS Event Create crypto slice only.
Android Release Event Create and Release Golf scorecard mutation proof remain
open.

## Evidence integrity

- The older false details captures, generic scrolled large-text names, and the
  source-to-old-published-implementation comparison were removed from this
  final folder.
- Scrolled states are named `scrolled`; natural-top states are named `top`.
- The creation screenshots never claim publication, invite readiness, or a
  completed `SCR-013` journey.
- [`asset-manifest.sha256`](./asset-manifest.sha256) binds the final source,
  flows, documentation, and visual artifacts after the last verification run.
- Manifest integrity does not turn the historical `00`–`07` visual comparison
  into current design acceptance; [`design-qa.md`](./design-qa.md) keeps that
  separate gate explicitly open.
