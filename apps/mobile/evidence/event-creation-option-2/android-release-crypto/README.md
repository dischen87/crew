# Android Release Event Create crypto and restart proof

Date: 2026-07-19  
Device: `emulator-5554`, `sdk_gphone64_arm64`, Android 16 / API 36  
Viewport: 1080 × 2400 physical, 412 × 915 logical at density 420

This is the missing Android Release-shaped Event Create slice for
`crew-paq.3.10` and the Event Create half of `crew-paq.3.11`. It proves the
existing production composition under the React Native Release crypto shape,
a retryable root-create `503`, exact durable replay after a real process
restart, and the resulting private Event Hub. It does not exercise or claim a
Golf scorecard mutation.

## Production boundary and Release shape

[`event-creation-production-entry.js`](../../event-creation-production-entry.js)
still composes the real `PrivateBootstrapGate`, `RootNavigator`, generated
`GatewayClient`, encrypted OP-SQLite adapter, migrations, durable outbox, and
Event Hub. [`EventCreateScreen.tsx`](../../../src/screens/EventCreateScreen.tsx)
constructs `MobileSyncEngine` with `randomUUID: secureUuidV4` and no SHA
provider. `secureUuidV4` uses `crypto.getRandomValues`; the engine therefore
uses its normal `sha256Hex` implementation and its pure-JavaScript fallback
when Web Crypto digest is absent.

The shared entry fails closed before rendering unless all three statements are
true:

- `crypto.randomUUID` is absent;
- `crypto.getRandomValues` is present;
- `crypto.subtle.digest` is absent.

The Android-only
[`event-creation-android-production-entry.js`](../../event-creation-android-production-entry.js)
does not inject a UUID or digest implementation. It only selects the controlled
fixture phase from a non-secret launch URL, mirrors the production light-mode
`StatusBar` treatment, and turns the already-sanitized proof record into a
temporary native alert because Release logging is stripped and Release
cleartext HTTP is disabled. The alert reconstructs an allow-listed schema; it
rejects invalid hashes or booleans and cannot retain extra fields.

The constant default idempotency callback on the fixture `GatewayClient` is not
used by root creation. The real outbox supplies its persisted
`root-<caller UUIDv4>` header explicitly. Before both the offline response and
the successful replay, the controlled POST boundary required every root and
template event identifier to be a unique lowercase RFC 4122 UUIDv4, the
template root to equal the command root, and the root idempotency suffix to be
a lowercase UUIDv4.

## Native restart sequence

1. A locally signed, non-debuggable Release APK launched with the controlled
   `create-offline` phase.
2. The native flow selected the Golf-tour template and submitted `Android
Release Crypto Replay`. The POST boundary emitted the first sanitized proof
   and then returned a retryable `503`.
3. The app showed `Entwurf gespeichert` and
   `Entwurf lokal gespeichert. Wartet auf Verbindung.` PID `2701` was the live
   process.
4. `am force-stop app.crew.next` terminated that exact process; `pidof` was
   empty. App data was not cleared or reinstalled.
5. The online phase launched a new Release process, PID `3616`. Opening Event
   Create discovered the durable command, replayed it automatically, emitted
   the second proof, and landed in Event Hub as `Privater Entwurf`.

[`sanitized-proof.json`](./sanitized-proof.json) contains the two retained POST
observations. No raw command body, event identifier, idempotency key, session
token, database key, or service credential is present.

| Value                           | Offline `503`                                                      | Restart replay   | Stable |
| ------------------------------- | ------------------------------------------------------------------ | ---------------- | ------ |
| Body SHA-256                    | `683d340816270b23a9645a2cdd3ad82e883e17a7eafc058c1e5daf6c615c4b0b` | same             | yes    |
| HTTP idempotency SHA-256        | `4a33aac18d714c53b47fe6498ec5687f64b1c090d94ed52568a4f5639e5448f8` | same             | yes    |
| Release crypto shape            | all three required booleans true                                   | same             | yes    |
| Strict caller IDs / idempotency | `secureIds=true`                                                   | `secureIds=true` | yes    |

## Evidence

- `00-offline-post-proof-*`: first allow-listed POST observation before the
  controlled `503`.
- `01-offline-enqueued-*`: clean, honest durable offline state after dismissing
  the proof alert.
- `02-replay-post-proof-*`: second allow-listed POST observation in the new
  process.
- `03-replayed-private-draft-*`: clean successful private Event Hub landing.
- Each state has an untouched 1080 × 2400 screenshot, a no-crop 412 × 915
  normalization, and a UI Automator semantics file.
- Four Maestro flows cover submit-to-proof, offline state, restart replay
  proof, and replay-to-private-Hub; all pass on `emulator-5554`.

## Build and gates

The Release APK was signed locally with the repository Debug keystore only for
emulator installation. It is not a store or deployment signature. APK
verification passed v2 and v3; the installed Release package rejected
`run-as`, confirming it was non-debuggable.

| Artifact                | SHA-256                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| Installed proof APK     | `576185015c2ca2474ee6725e472453306ce6ad1212163b53451c4f7ff8ea571d` |
| Release Hermes bundle   | `d1efa7264dadae8ceab82765c60547035208256da1e9231b961bc9c6d2aa410c` |
| Android evidence entry  | `a0a67bb0a98a8f56714a2a8b5586e7042c3a911c4f96e4d6073329ae9fe5004f` |
| Shared production entry | `874f7286a74110bc768d1ea95860e560a6f5a3536cfcd6418f663ac249df62d2` |
| `EventCreateScreen.tsx` | `85edba95ca5632fd65b882a2cf42a74203dabd9b0bb536d13c16325a463b6b95` |
| `secureRandom.ts`       | `c564392de1d77beb809b6cd42088596b61e2e13b4dd923e3ff632ce9396bdeb8` |
| mobile-data `outbox.ts` | `8f001b12bd9caa77918d237bb21a8a075e091634b2aa5eda28ad77276418ed0a` |
| mobile-data `sha256.ts` | `ba2ecd54b10bcec9a860632fd70a165bb5e6504fdd61acece1f0e78856cc591b` |

The lane-local Android build tree grew from 2,689,808 KiB to 2,708,900
KiB: 19,092 KiB (about 18.6 MiB), well below the 1.5 GiB guard. No cleanup was
needed.

- Focused app gate: 5/5 suites and 35/35 tests pass.
- Full `apps/mobile`: ESLint and TypeScript pass; 62/62 suites and 496/496 tests
  pass.
- Focused mobile-data SHA/outbox gate: 47/47 tests and 416 assertions pass.
- Full `packages/mobile-data`: Biome and TypeScript pass; 137/137 tests and 951
  assertions pass.
- Release bundle, Release assemble, APK v2/v3 verification, and all four native
  Maestro flows pass.

## Restoration and remaining scope

The original Debug APK was restored byte-for-byte at SHA-256
`a69cd7520f860be011991320564502885cb0e81c17ba7c668408f7ff7de2dfa8`.
All 16 protected app-data files match the baseline byte-for-byte after a
stability wait, and the running Debug app is back at the signed-out
`Bitte anmelden` surface. Font scale 1.0, physical 1080 × 2400, density 420,
Accessibility disabled with no services, hardware-keyboard IME setting 0, and
the exact 8082 and 3000 reverses were preserved. Host listeners stayed PID
45252 on 8081 and PID 70661 on 8082; 3000, 3101, 3199, 5433, and 6380 remained
closed. The restored Debug process is PID `4248`; the former app PID cannot be
reused after the required exact process-termination proof.

This completes Android Release-shaped Event Create only. The separate native
Golf scorecard mutation proof remains open, so this evidence does not close or
claim that slice. No commit, push, deployment, iOS action, or 8081 mutation was
performed.
