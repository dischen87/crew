# Private unavailable Option 2 — iOS design QA

Current result: **iOS and Android Design-2 behavior accepted; Bead closed.**

- Device: exact iPhone 16e simulator, iOS 26.2.
- Viewport: exact 390 x 844 points; persisted 1170 x 2532 raw captures and
  uncropped 390 x 844 derivatives.
- Content sizes: normal and real iOS Accessibility Large.
- Appearance: light.
- Production surfaces: `PrivateBootstrapGate`,
  `PrivateUnavailableScreen`, and `PrivateAccessView`.
- States: known private-data unavailable, unknown secure-storage unavailable,
  native confirmation, signed out, normal and Accessibility Large.
- Same-state comparison:
  `comparison-retry-only-vs-safe-escape-780x894.png`, with exact complete
  historical/current panels and explicit provenance labels.
- Android parity: Android 16 / API 36, 1080 x 2400 at 420 dpi, normal and 1.3
  text scale; seven native screenshots, paired UIAutomator semantics, and nine
  executed Maestro flows are retained under `android/`.

## Findings

- P0: none in the accepted cross-platform evidence slice.
- P1: none in the accepted cross-platform evidence slice.
- P2: none in the accepted cross-platform evidence slice.

## Visual and interaction acceptance

- The unavailable surface retains the Crew Board visual language: lavender
  canvas, gold recovery card, black outline/shadow, checked-in Crew assets,
  DM Sans hierarchy, explicit status text and high-contrast actions.
- Retry is visually and semantically primary, appears before the safe escape,
  and remains a direct action.
- The secondary safe escape is visibly available without suggesting data
  deletion. Its native German confirmation repeats that protected offline data
  remains unchanged and gives distinct cancel/confirm actions.
- Known private-data and unknown secure-storage failures share concealment and
  recovery structure while using truthful distinct status and description
  copy. Neither reveals an account, event, request, token or storage path.
- The signed-out state is visually clean and contains no private event or
  account detail.
- The exact same-state comparison makes the product change legible: the
  historical retry-only screen is on the left, while the source-current safe
  escape is on the right. No historical image is described as current.

## Accessibility and responsive acceptance

- At normal text, title, state copy, privacy guarantee and both actions are
  visible without crop. The native confirmation and both choices are readable.
- At Accessibility Large, the top capture preserves title, description,
  status and guarantee; the paired scroll capture proves Retry and safe exit
  remain reachable. The native confirmation retains readable body copy and
  reachable actions.
- The unavailable surface uses one vertical scroll path. Text wraps naturally
  and the action components retain their production minimum target size.
- Read-only native hierarchy inspection exposed the reading order as title,
  description, status, alert message, Retry, safe exit. Both controls expose
  their labels. No host or simulator VoiceOver setting was changed.
- XCTest did not surface the React Native accessibility hint in its hierarchy
  output. Therefore runtime evidence is limited to the label/order; the
  production prop and focused component test bind the hint itself.
- State changes use the production assertive live region and alert semantics;
  copy never relies on color or icon alone.

## Safety and exact-once acceptance

- Cancelling the native dialog at normal and Accessibility Large retained the
  unavailable screen and did not change proof counters.
- Two confirm invocations produced one guarded known-account session
  compare-and-set, one matched account-scoped in-memory clear, and no database
  open or persistent purge.
- Unknown identity produced signed-out UI without a second protected-storage
  read and without key, database, compare-and-set, clear or purge operations.
- The deterministic proof uses only in-memory synthetic dependencies and
  publishes sanitized counters/booleans. No real Keychain item, session or
  database was read, corrupted, cleared or deleted.

## Review history

1. The production unavailable surface was captured in the known failure mode
   at normal text.
2. Retry, native confirmation cancellation, and repeated confirmation were
   driven through native UI; sanitized dependency counters were retained.
3. The known screen, reachable actions, and native confirmation were recaptured
   at Accessibility Large and checked for wrapping, crop and reachability.
4. The unknown secure-storage mode and its non-destructive signed-out result
   were captured separately.
5. Native hierarchy order was inspected without changing VoiceOver settings.
6. The historical retry-only and current safe-escape screens were combined as
   a same-state, pixel-preserving comparison and visually accepted.
7. The original Debug app, content size, appearance, signed-out state,
   settings, Metro listeners, and unrelated simulator process were restored.
8. Android repeated the known/unknown, Retry, cancel, confirmation, exact-once,
   signed-out, and Large-Text checks. Its APK, emulator settings, reverse
   mappings, and Metro listeners were restored exactly. Full Debug app-data
   archive equality is intentionally not claimed because the baseline tar was
   hashed but not retained; protected DB, WAL/SHM, Keychain, and attachment
   content stayed unchanged.

## Acceptance checklist

- [x] Exact iPhone 16e normal evidence.
- [x] Exact iPhone 16e Accessibility Large top and reachable-action evidence.
- [x] Native German confirmation at both content sizes.
- [x] Retry primary and direct.
- [x] Cancel leaves state and counters unchanged.
- [x] Repeated known-account confirmation is exact-once and account-scoped.
- [x] Unknown identity path is non-destructive.
- [x] No protected identifier appears in copy or public proof.
- [x] Same-state historical/current visual comparison accepted.
- [x] Exact Debug environment restored.
- [x] Native Android behavior, native confirmation, semantics and Large-Text
      evidence; exact full Debug app-data archive restoration remains an
      explicit non-product evidence boundary.
