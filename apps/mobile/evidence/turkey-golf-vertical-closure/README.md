# Turkey Golf vertical closure

Date: 2026-07-20

This matrix closes the remaining local-product and E2E gap for
`crew-paq.7.2` and `crew-paq.7.4`. It combines a fresh service-composed run
through the real Gateway, User Service, Event Service and PostgreSQL with the
retained native iOS/Android offline evidence. It is not a production deployment
claim.

## Service-composed journey

The existing API-only Turkey fixture now executes the missing live journey in
addition to the deterministic event tree:

1. Owner creates the `golf-tour` root, resolves the five stable Belek OSM
   candidates, creates travel/lodging/transport/golf capabilities and eleven
   itinerary items, then creates organizer and participant invitations.
2. Organizer and participant authenticate independently and redeem their
   email-bound invitations.
3. Participant itinerary mutation is rejected with `403` before any write.
4. Organizer updates the arrival child and the Antalya-to-Belek itinerary item;
   the participant reads the updated version through the Gateway.
5. Organizer posts the live transfer update and participant stores one
   `celebrate` reaction; the participant read returns one entry and one reaction.
6. Participant bootstraps, queues the existing Golf score intent, pushes,
   replays the identical request and pulls the converged score and leaderboard.
7. Owner, organizer and participant independently read the same published root.

Every successful domain write is immediately replayed with the same
idempotency key and must return byte-identical JSON with
`Idempotency-Replayed=true`.

### Authoritative PostgreSQL result

- 8 published events and 3 active memberships.
- 2 consumed invitations, 9 places and 11 itinerary items.
- 1 travel, 1 transport, 1 lodging and 5 Stableford capabilities.
- Organizer arrival child at version 5 and transfer itinerary item at version
  2 with the expected live copy.
- Exactly 1 organizer live-feed entry and 1 present participant reaction.
- Exactly 1 participant Golf score receipt/row after replay.

The fresh guarded databases were
`crew_fixture_user_test_0720_turkey` and
`crew_fixture_event_test_0720_turkey`. Both were dropped after the green run
and their absence was verified.

## Trace IDs

The Gateway and owning service echoed each exact ID. The focused live sequence
uses:

- `fixture.participant.itinerary.update.denied.v1`
- `fixture.organizer.event.arrival.live-update.v1` and `.replay.v1`
- `fixture.organizer.itinerary.transfer.live-update.v1` and `.replay.v1`
- `fixture.organizer.feed.transfer-update.create.v1` and `.replay.v1`
- `fixture.participant.feed.transfer-update.react.v1` and `.replay.v1`
- `fixture.participant.itinerary.read.v1`
- `fixture.participant.feed.read.v1`
- `fixture.e2e.golf-tour.{ios|android}.{bootstrap|push|push.replay|pull}.v1`

No access token, magic link, invitation token, raw idempotency key or request
body is retained in this evidence.

## Native and mobile proof

- [iOS Release Golf proof](../golf-scorecard-ios-release-crypto/README.md):
  current production composition, one queued score, exact cold relaunch,
  committed-503 retention, identical replay, participant convergence and fresh
  owner readback. Its 33-file SHA-256 manifest passes.
- [iOS participant to Android owner](../native-e2e-2026-07-19/golf-row-1-evidence-matrix.md):
  first device/role orientation with read-only PostgreSQL proof.
- [Android participant to iOS owner](../native-e2e-2026-07-19/golf-row-2-evidence-matrix.md):
  reverse device/role orientation with cold restart, lost acknowledgement and
  independent owner readback.
- `EventHubScreen.test.tsx` now verifies that the participant SQLite projection
  renders flight, road transfer, lodging and Golf rows, selects the next action
  and exposes the production Golf route.

## Green gates

- Fixture unit: 6 tests, 124 assertions.
- Fresh PostgreSQL/Gateway fixture: 5 tests, 624 assertions.
- Event Hub focused mobile: 14 tests.
- Native runner guards/fault facade: 14 tests, 1 environment-only skip, 177
  assertions.
- Mobile TypeScript and ESLint: pass.
- Infra Biome and scoped whitespace check: pass.

## Boundary

The local acceptance is complete. No fresh production deployment, hosted
backend, App Store/TestFlight build or physical-device run is claimed. The
retained simulator/emulator evidence is cryptographically bound to its recorded
inputs; a different deployed backend or release artifact must repeat the same
matrix before a production claim.
