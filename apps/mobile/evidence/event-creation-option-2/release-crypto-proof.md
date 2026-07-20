# iOS Release crypto and replay proof

Date: 2026-07-19  
Device: iPhone 16e, iOS 26.2, 390 × 844 points  
UDID: `F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`

This is a functional Release proof for the production-routed Event Create
boundary. It complements the historical visual set; it does not close the
separate current visual gate in [`design-qa.md`](./design-qa.md).

## Release shape

The app was built as `Release` for the exact simulator above, with
`event-creation-production-entry.js` as the entry point. The installed app had
no `CrewNext.debug.dylib` or `__preview.dylib`, and launched without Metro
arguments.

The evidence entry fails closed before rendering unless the React Native
runtime has this exact shape:

- `crypto.randomUUID`: absent;
- `crypto.getRandomValues`: present;
- `crypto.subtle.digest`: absent.

`EventCreateScreen` supplies `secureUuidV4` to `MobileSyncEngine` and supplies
no SHA implementation. `secureUuidV4` uses `crypto.getRandomValues` and masks
the RFC 4122 version and variant bits. The durable outbox therefore used the
normal `sha256Hex` fallback, not an injected evidence digest.

At the Gateway POST boundary, the fixture rejected the command unless every
root and template event identifier matched strict lowercase UUIDv4 identity,
template IDs were unique, the template root mapped to the command root, and
the root HTTP idempotency key ended in a strict UUIDv4. Validation happened
before both the controlled offline response and the successful replay.

## Restart sequence

1. The Golf-tour template created the local command while the controlled
   Gateway boundary returned a retryable `503`.
2. The UI exposed `Entwurf gespeichert` and
   `Entwurf lokal gespeichert. Wartet auf Verbindung.`
3. The app process was terminated exactly; simulator data was not cleared and
   the app was not uninstalled.
4. The Release app was relaunched without Metro arguments. Opening Event Create
   read and verified the persisted command, replayed it, and landed in Event
   Hub as `Privater Entwurf`.
5. A loopback collector accepted only the sanitized proof schema and rejected
   any extra fields. It was stopped after capture.

The two accepted records are in
[`release-crypto-sanitized-proof.json`](./release-crypto-sanitized-proof.json).
They contain only SHA-256 fingerprints and booleans. The body and idempotency
fingerprints are identical before and after the process restart:

| Fingerprint                  | Offline enqueue                                                    | Process-restart replay |
| ---------------------------- | ------------------------------------------------------------------ | ---------------------- |
| Command body SHA-256         | `47385497c84c705fc035c7aa3676cd179d9f1ca8972fcbb8e6deb945e6837a6b` | same                   |
| HTTP idempotency key SHA-256 | `52c57143bd345af2512a20838ca52aa67d9f62e99de07bd8a58d70c1e4f47408` | same                   |

No raw command body, event ID, idempotency key, session token, database key, or
service credential was retained in this proof.

## Build and source fingerprints

| Artifact                                                 | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Release `CrewNext` executable after final ad-hoc signing | `378d9c04e9ccabfd477f1a5c7c1365fbfc295865f086be1fc7f454d30f7bc6f6` |
| Release `main.jsbundle`                                  | `9cab084dd8980eacb5d51434338d9ccc752eac512a883c825252daa930fd2fe6` |
| Release `Info.plist`                                     | `2e21e15405ad7bc25a8babcfe36c0e0d4e3820562bd5164dbb4528ea0266ea54` |
| Evidence entry                                           | `874f7286a74110bc768d1ea95860e560a6f5a3536cfcd6418f663ac249df62d2` |
| `EventCreateScreen.tsx`                                  | `85edba95ca5632fd65b882a2cf42a74203dabd9b0bb536d13c16325a463b6b95` |
| `secureRandom.ts`                                        | `c564392de1d77beb809b6cd42088596b61e2e13b4dd923e3ff632ce9396bdeb8` |
| `outbox.ts`                                              | `8f001b12bd9caa77918d237bb21a8a075e091634b2aa5eda28ad77276418ed0a` |
| `sha256.ts`                                              | `ba2ecd54b10bcec9a860632fd70a165bb5e6504fdd61acece1f0e78856cc591b` |

The final JavaScript-only rebundle changed the proof directory by `0 KiB`.
The earlier full native build temporarily grew by `1,664,888 KiB`, which was
`92,024 KiB` (about 90 MiB) above the requested 1.5 GiB guard. That deviation
is recorded rather than hidden. Its exact DerivedData directory was deleted
immediately after the Release app was copied, returning the proof directory to
about 156 MiB before final cleanup.

## Evidence and gates

- [`08-release-crypto-offline-enqueued-390x844.png`](./08-release-crypto-offline-enqueued-390x844.png): honest locally queued state.
- [`09-release-crypto-replayed-private-draft-390x844.png`](./09-release-crypto-replayed-private-draft-390x844.png): successful replay and private-draft landing.
- Native Maestro enqueue and restart-replay flows: pass on the exact iPhone 16e.
- `apps/mobile` TypeScript and ESLint: pass; the evidence entry has one existing
  inline-style warning and no error.
- Focused Events, Event Create, and navigator Jest gate: 4/4 suites and 33/33
  tests pass.
- `packages/mobile-data` TypeScript, Biome, and full test gate: 137/137 tests
  and 951 expectations pass, including no-Web-Crypto SHA and restart replay.

The evidence harness initially used a whole-account purge during bootstrap,
which removed the pending row on relaunch. It was corrected to the same
recorded-denial and retained-attachment reconciliation boundaries used by the
production private bootstrap. No production security or authorization boundary
was weakened.

## Restoration and remaining scope

After the proof, only the generated local evidence database trio was removed.
The saved Debug app was reinstalled and verified byte-for-byte. Its executable,
Debug dylib, preview dylib, and `Info.plist` hashes match the baseline; the
signed-out screenshot also matches byte-for-byte at
`9e671a6d3d7854f4e313bf49d28ed2a65bde747597e88a2d4361b9db1cd01b53`.
The simulator is back to medium content size, light appearance,
`CrewEvidenceState=capability`, no crypto-proof setting, and
`-RCT_jsLocation localhost:8082`. Existing listeners on 8081 and 8082 and the
iPhone 17 Pro process were not changed. The proof collector on 3199 is closed.

This fixture exercises a Golf-tour template because it has multiple child event
IDs. It does **not** prove a Golf scorecard mutation. Android Release-shaped
Event Create and Release Golf enqueue/replay remain separate acceptance work.
No backend, deployment, or service-database result is claimed.
