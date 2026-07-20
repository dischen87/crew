# Private unavailable — safe Option-2 escape evidence

This folder is the cross-platform native evidence for the `crew-paq.3.5.6`
`PrivateUnavailable` recovery slice. The current production
`PrivateBootstrapGate`, `PrivateUnavailableScreen`, and `PrivateAccessView`
were exercised on the exact iPhone 16e simulator at normal text and
Accessibility Large, and on Android 16 at normal and 1.3 text scale.

The iOS and Android Design-2 behavior is accepted and the Bead is closed.
Android screenshots, semantics, native-flow records, and its explicit Debug
restoration boundary are retained under [`android/`](./android/README.md).

## What passed

- `Erneut versuchen` remains the first, primary action and directly retries
  the private bootstrap. It does not open a confirmation or sign out.
- `Sicher zur Anmeldung` opens the native German confirmation. Cancelling at
  normal text and Accessibility Large left the unavailable state and all proof
  counters unchanged.
- Repeating the confirmation action twice caused exactly one guarded session
  compare-and-set and one account-scoped in-memory clear for the known
  account. It did not open a database, reconcile or delete attachments, purge
  feedback, or purge denied roots.
- When protected session storage made the account identity unknown, the same
  escape exposed only signed-out UI. It did not retry protected storage,
  derive/read a database key, compare-and-set a session, clear account state,
  open a database, or purge anything.
- Both unavailable reasons remain concealed but visually distinct:
  `PRIVATE DATEN GESPERRT` for known private-data failure and
  `GERÄTESCHUTZ NICHT ERREICHBAR` for unavailable secure storage.
- The signed-out destination contains no private event or account detail.

## Persistent native evidence

| Evidence                                                                                             | Purpose                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [Known private-data failure, normal](./01-known-private-data-normal-390x844.png)                     | Retry-first unavailable surface and safe secondary escape                |
| [Native confirmation, normal](./02-native-confirmation-normal-390x844.png)                           | German title, unchanged-data explanation, cancel and confirm actions     |
| [Known-account signed out, normal](./03-known-signed-out-normal-390x844.png)                         | Destination after the guarded exact-once transition                      |
| [Accessibility Large, top](./04-known-private-data-accessibility-large-top-390x844.png)              | Uncropped title, explanation, status and private-data guarantee          |
| [Accessibility Large, actions](./05-known-private-data-accessibility-large-actions-390x844.png)      | Reachable Retry and safe-exit actions in the scroll surface              |
| [Native confirmation, Accessibility Large](./06-native-confirmation-accessibility-large-390x844.png) | Readable, reachable confirmation with no clipped action                  |
| [Unknown identity, normal](./07-unknown-secure-storage-normal-390x844.png)                           | Distinct secure-storage copy without protected identity disclosure       |
| [Unknown-identity signed out, normal](./08-unknown-signed-out-normal-390x844.png)                    | Non-destructive destination when account identity cannot be trusted      |
| [Retry-only versus safe escape](./comparison-retry-only-vs-safe-escape-780x894.png)                  | Exact-panel historical/current comparison of the same unavailable state  |
| [Sanitized interaction proof](./native-interaction-proof.json)                                       | Native retry, cancel and exact-once dependency counters                  |
| [Design QA](./design-qa.md)                                                                          | Visual, interaction, accessibility and privacy acceptance                |
| [Android native evidence](./android/README.md)                                                       | Android 16 parity, Large Text, native semantics and restoration boundary |

Every 390 x 844 image has an uncropped 1170 x 2532 simulator capture beside
it. The comparison keeps the complete historical and current 390 x 844 panels
pixel-identical to their source images under a 50-pixel label header. Its left
panel is deliberately labelled historical retry-only evidence; it is not
presented as current source acceptance.

## Native proof counters

The proof sink accepted only counter and boolean fields; it retained no raw
account identifier or session value.

| Scenario                           | Observed counters                                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known failure, Retry               | session reads 2; database-key reads 2; compare-and-set 0; account clear 0; database open and every purge/reconciliation counter 0                                                                                            |
| Known failure, repeated confirm    | session reads 3; database-key reads 2; compare-and-set 1 with the expected-session guard matched and null replacement; account-scoped clear 1 with its guard matched; database open and every purge/reconciliation counter 0 |
| Unknown identity, repeated confirm | session reads 1; database-key reads 0; compare-and-set 0; account clear 0; database open and every purge/reconciliation counter 0                                                                                            |
| Native cancel, normal              | proof count 1 before and after; unavailable surface retained                                                                                                                                                                 |
| Native cancel, Accessibility Large | proof count 2 before and after; unavailable surface retained                                                                                                                                                                 |

The native confirmation flow intentionally repeated `Zur Anmeldung` twice;
the saved proof records `nativeConfirmationDoubleTapCount: 2` and still only
one guarded transition for the known-account case.

## Production and evidence boundary

`apps/mobile/evidence/private-unavailable-option-2-entry.js` is an isolated
native entry. It composes the production gate, lifecycle boundary and screens,
but supplies only in-memory failure dependencies. The known scenario throws
before a database can open; the unknown scenario throws on the first session
read before a key or database can be reached. Any unexpected database or purge
operation increments the public proof and fails the acceptance invariant.

The entry is not imported by production code. It never calls the real
Keychain, database adapter, Gateway, query cache, attachment store, or purge
services. No real session, account-scoped database, Keychain item, or app data
was changed or deleted. Production lifecycle and screen behavior are bound by
the focused tests listed in `asset-manifest.sha256`.

## Accessibility inspection

The exact viewport was iPhone 16e, iOS 26.2, 390 x 844 points. Normal and
Accessibility Large captures use the production scroll surface; the Large
sequence proves both the top content and off-screen actions are readable and
reachable.

A read-only native accessibility-hierarchy inspection, without enabling or
changing host VoiceOver, exposed this order for both unavailable reasons:
header/title, description, status, alert message, `Erneut versuchen`, then
`Sicher zur Anmeldung`. The hierarchy exported the safe-exit accessibility
label. XCTest did not export the React Native hint text in this run; the
production `accessibilityHint` and focused component assertion remain the
source-level proof for that hint. No stronger runtime hint claim is made.

## Reproduction boundary and restoration

- Simulator: iPhone 16e, iOS 26.2, exact 390 x 844 point viewport.
- Evidence app: a copied Release simulator app with only its JS bundle
  replaced, then re-signed; Metro and the installed Debug tree were untouched.
- Evidence entry SHA-256:
  `cde22f259868bf3c47e51ac0bedf5d3ad5c8c4442a32714598fb86e1d3c68245`.
- Production binding SHA-256:
  `PrivateBootstrapGate.tsx`
  `c658b35889c452d425fd465041e3362e3e1f810d1563a73c25eb6987c541ce60`;
  `PrivateAccessScreen.tsx`
  `6e67a5ef402b92d32bf90683fb76ecdffb927341d4485bdd015514a63a314004`.
- Re-signed Release evidence executable SHA-256:
  `fadb65e382e82a8a31ce30b22bd30038b3892bb6ef88d9d44a6092a94191745a`;
  JS bundle:
  `f49000b345cb6c2c6a281ee6e37465dcb8450b36f3b6ae21a2f33cd32c0e9681`;
  `Info.plist`:
  `2e21e15405ad7bc25a8babcfe36c0e0d4e3820562bd5164dbb4528ea0266ea54`.
- The temporary evidence tree added 59,752 KiB, below the 1.5 GiB ceiling.
- After capture, the exact saved Debug app tree was reinstalled byte-for-byte,
  content size restored to medium, appearance restored to light, evidence
  settings removed, and the signed-out baseline reproduced byte-identically.
  Existing Metro listeners and the separate iPhone 17 process remained
  unchanged.

The Maestro YAML files in this folder are the exact iOS native flows used for
Retry, confirmation, cancellation, repeated confirmation, Large Text reach,
and unknown secure-storage evidence. They contain no protected identifier.
The Android subfolder retains its nine executed flows and verified manifests.
Its Debug APK, emulator settings, reverse mappings, and Metro listeners were
restored exactly. Sensitive database, WAL/SHM, Keychain, and attachment
content stayed unchanged, but full Debug app-data archive byte equality is not
claimed because the baseline tar itself was not retained.
