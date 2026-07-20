# Private unavailable Option 2 — Android design QA

Current result: **Android native parity accepted for Design 2; exact Debug
app-data restoration remains open.**

- Device: `sdk_gphone64_arm64`, Android 16 / API 36.
- Viewport: 1080 x 2400 px at 420 dpi.
- Text scales: normal 1.0 and accessibility-large proxy 1.3.
- Production surfaces: `PrivateBootstrapGate`,
  `PrivateUnavailableScreen`, and `PrivateAccessView`.
- States: known private-data unavailable, unknown secure-storage unavailable,
  native confirmation, and signed out.

## Findings

- P0: none.
- P1: none.
- P2: none in the accepted Android evidence slice.

## Visual and copy acceptance

- The screen retains Crew's distinctive Design 2 language: lavender canvas,
  gold recovery card, heavy black border and offset shadow, DM Sans hierarchy,
  explicit status chip, mint primary action, and white secondary action.
- Retry remains visually and semantically primary and precedes the escape.
  The secondary action is clearly available without looking destructive.
- At both text scales, German headings and body copy wrap naturally. No title,
  description, status, privacy message, button label, or native dialog action
  is clipped or cropped.
- `PRIVATE DATEN GESPERRT` and `GERÄTESCHUTZ NICHT ERREICHBAR` accurately
  distinguish private-data and protected-storage failures without technical or
  private identifiers.
- The native dialog explicitly says protected offline data stays unchanged;
  its cancel and confirm actions are unambiguous.
- The signed-out destination is clean and contains no event or account detail.

## Responsive and accessibility acceptance

- At normal scale, the complete unavailable state and both actions fit the
  viewport. At 1.3, they remain fully readable and reachable in the production
  scroll surface.
- Controls retain large native hit areas and do not rely on color alone.
- Read-only UIAutomator semantics expose title, description, status,
  unchanged-data message, Retry, and safe-exit labels in that order. Native
  confirmation semantics expose title, explanation, cancel, then confirm.
- TalkBack was not enabled, so this evidence proves native labels/order but
  does not claim spoken runtime output.

## Interaction and privacy acceptance

- Normal cancel left proof count 1 → 1; 1.3-scale cancel left 2 → 2. The
  unavailable state remained visible.
- Known double confirmation caused one expected-session CAS-to-null and one
  matched account-scoped in-memory clear. Database open, migration,
  reconciliation, and all persistent purge counters remained zero.
- Unknown double confirmation produced signed-out UI after one session read,
  with key, CAS, clear, database, migration, reconciliation, and purge counters
  all zero.
- The proof is synthetic and fails before real storage. The selectors do not
  import or patch production lifecycle/storage dependencies; the unchanged
  harness composes the production gate and screens with isolated in-memory
  dependencies.
- The evidence package is separate and non-debuggable. Its synthetic harness
  did not call the real session store, Keychain, account database, Gateway,
  query cache, attachment store, or purge services. No protected record or
  account root was cleared, corrupted, or purged.

## Emulator restoration boundary

- The production-source aggregate remained exactly
  `b89716cc86d84799644cb3197edf3289c7ae3afacbd4e7ce012d64195d0bac70`.
- The installed Debug APK was restored exactly to SHA-256
  `a69cd7520f860be011991320564502885cb0e81c17ba7c668408f7ff7de2dfa8`.
  The evidence package was removed. Emulator settings, ADB reverses, the two
  pre-existing Metro listeners, and their PIDs matched the captured baseline;
  the Debug activity was again foreground.
- Sensitive database, WAL/SHM, Keychain, and attachment data were left
  unchanged by the scoped evidence and restoration operations. The required
  Debug relaunch regenerated React Native's dev bundle, AndroidX
  `profileInstalled` marker, and `files/` metadata. This is an operation-scope
  claim: the initial per-file baseline command produced no usable manifest, so
  byte-for-byte equality cannot be asserted for individual protected files.
- Full app-data archive equality was not recovered. The frozen baseline tar
  was hashed but not retained; its SHA-256 was
  `7b6c3a5dc0f806c2ec6400e90543a266f97ffb933a70610d8860660d108eabfb`;
  the first captured post-launch archive was
  `4048fa8677e7f1cc3cc81a5e2247de1aae5d9d83fd032d905091d4c062affabf`.
  A bounded reconstruction tested the corrected pre/post race-fix bundles,
  the exact historical profile marker, and the observed timestamps without a
  full-tar match. The stable final device archive is
  `a0d8d82ad90e6338db87b6508903eb8af58a2605a0dc7511341310ed2f5a0f22`.
- Therefore this evidence accepts the Android product behavior and visual QA,
  but makes no exact Debug app-data restoration claim. The release checklist
  and Bead remain open on that audit item.

## Review sequence

1. Captured known private-data failure at normal scale.
2. Drove Retry, native confirmation, cancellation, and repeated confirmation.
3. Captured the clean known-account signed-out result.
4. Repeated the unavailable and native-dialog checks at 1.3 font scale.
5. Captured the distinct unknown secure-storage failure and repeated-confirm
   signed-out result.
6. Inspected every persisted screenshot and its read-only native semantics.
7. Ran boundary, formatting, focused Jest, TypeScript, ESLint, proof-invariant,
   and raw-identifier gates.

## Acceptance checklist

- [x] Native Android normal evidence.
- [x] Native Android 1.3-scale evidence with reachable actions.
- [x] German native confirmation at both scales.
- [x] Retry first, primary, and direct.
- [x] Cancel leaves state and counters unchanged.
- [x] Repeated known-account confirmation is exact-once and account-scoped.
- [x] Unknown identity path is non-destructive.
- [x] No protected identifier appears in UI, semantics, or public proof.
- [x] Production source stayed frozen during the evidence run.
- [x] Debug APK, production source, evidence-package removal, emulator
      settings, reverses, and pre-existing Metro listeners restored.
- [ ] Exact full Debug app-data archive restoration verified.
