# iPhone 16e Option-2 state recovery evidence — 2026-07-19

## Scope

- Device: iPhone 16e, iOS 26.2, UDID `F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`.
- Viewport: 390 × 844 logical points; screenshots are 1170 × 2532 pixels.
- Dynamic Type was changed only on this simulator from `accessibility-large` to `medium` and verified as `medium` after both final launches.
- The separate iPhone 17 Pro simulator was not operated. No process on port 8081 was stopped, restarted, or reconfigured. Metro for this run remained on port 8082.
- This is Debug-simulator evidence. It is not release, production-backend, Android, or deployment evidence.

## What the initial screens meant

The first visible generic Unavailable screen was a previously retained invalid-link route, not the private-bootstrap diagnosis. Selecting the product action **Zu Events** exposed the real fail-closed state: **Private Daten nicht verfügbar** with **Erneut versuchen**.

Retry reproduced a Keychain authorization failure from `SecItemCopyMatching_ios`: OSStatus `-34018`, “Client has neither application-identifier nor keychain-access-groups entitlements”. The previously installed Debug binary had no usable simulator application identifier or Keychain access group. This prevented the first session read before an account database could open.

The diagnosis was causal, not inferred from stale data: no Crew Keychain item was deleted. Installing the entitlement-bearing build over the existing app made the same bootstrap reach the signed-out state, and a second launch reached the identical state again.

## Corrected native build and Metro routing

The final app was built without cleaning or changing the Xcode project:

```sh
xcodebuild \
  -workspace ios/CrewNext.xcworkspace \
  -scheme CrewNext \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3' \
  -derivedDataPath /Users/mathias/Library/Developer/Xcode/DerivedData/CrewNextNativeE2E \
  RCT_METRO_PORT=8082 \
  CREW_NATIVE_E2E_REQUEST_ID=crew-e2e.ios \
  ENTITLEMENTS_ALLOWED=YES \
  CODE_SIGN_IDENTITY=- \
  build
```

`codesign --verify --deep --strict` passed. The installed executable contains the simulator `__TEXT,__entitlements` payload:

```text
application-identifier = WFSHGY54TA.app.crew.next
keychain-access-groups = [WFSHGY54TA.app.crew.next]
```

The installed Info.plist contains `CrewNativeE2ERequestID=crew-e2e.ios`.

React Native 0.86 is linked through a prebuilt React-Core framework whose default bundle-provider port remains 8081; the Xcode `RCT_METRO_PORT` override does not rebuild that framework. The first corrected native launch therefore diagnosed a JS/native mismatch by contacting the unrelated 8081 bundle. No 8081 process was changed. The evidence launches used the app-scoped Debug argument below, and unified logs prove the bundle and assets were loaded from `localhost:8082`:

```sh
xcrun simctl launch F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3 \
  app.crew.next -RCT_jsLocation localhost:8082
```

## Evidence inspected in this run

| File                                                         | SHA-256                                                            | What it proves                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios-01-unavailable-medium-before-cleanup.png`               | `4d481f10fbed85a4c0c6b304f09f28f28dfce0e53f36d333063e7446455692cf` | Generic retained invalid-link route at medium Dynamic Type; not the bootstrap root cause.                                                                                                                                                                                          |
| `ios-02-private-unavailable-medium.png`                      | `7377e104951ba60c6048bfe9aa710175cbf3785d24661e16e02434da4a7a5519` | Real fail-closed private-bootstrap screen after **Zu Events**, with no private identifiers or content exposed.                                                                                                                                                                     |
| `ios-03-signed-out-medium-entitled.png`                      | `9e671a6d3d7854f4e313bf49d28ed2a65bde747597e88a2d4361b9db1cd01b53` | Entitlement-bearing build reaches the Option-2 signed-out state over Metro 8082 without deleting Keychain data.                                                                                                                                                                    |
| `ios-04-signed-out-medium-relaunch.png`                      | `9e671a6d3d7854f4e313bf49d28ed2a65bde747597e88a2d4361b9db1cd01b53` | Terminate/relaunch reproduces the exact signed-out pixels and successful Keychain reads.                                                                                                                                                                                           |
| `ios-05-participant-magic-request-accepted-medium.png`       | `615db30760bfee3b482594a0cd96f559f3e9adac8e12c1cc53664c2c02223998` | Participant fixture address reaches the enumeration-safe **Anfrage angenommen** state. No token or link was retrieved or displayed.                                                                                                                                                |
| `ios-06-participant-events-390x844.png`                      | `3885dc87fa58af892a9fc461b3c0da4eb64de38f633239e11ea14a66d8217d74` | Redeemed participant reaches one published **Turkey Golf Tour 2026** event through the real native route. Raw source: `ios-06-participant-events-1170x2532.png`, SHA-256 `59f665038d31f1d78998298ea3dd8c688c5d289792ba80f046f4e5ef1beb9739`.                                       |
| `ios-07-participant-carya-day-390x844.png`                   | `9d1ca2c59236391f5e96fea051e9fe384d6ecf0cc05014709de05b63779eb0ab` | Monday, 5 October is selected and exposes the read-only **Golf round: Carya Golf Club** row. Raw source: `ios-07-participant-carya-day-1170x2532.png`, SHA-256 `61ef9086990f031deffa3a5beb629080b5626cdf45ed74596f56e939df771659`.                                                 |
| `ios-08-participant-carya-scorecard-hole1-ready-390x844.png` | `b2ef2354b7d1c409ec94599467bc3def2bbd4deb7d627d5f8c2163ad09db5ec5` | Participant Scorecard is open with Hole 1 selected and both inputs edit-ready but untouched. Raw source: `ios-08-participant-carya-scorecard-hole1-ready-1170x2532.png`, SHA-256 `3a60c812325e9769e430afa327ea1e324fd6afc10254e3959dca12276fc2cf43`.                               |
| `ios-09-participant-carya-hole1-local-queued-390x844.png`    | `f07718d066a5fbb8293aa1fc5073b51e351a3d2b5a621c9c391c42e5e8245955` | With transport detached, exactly one local save shows Hole 1 as queued with 5 strokes, 2 putts and 2 local Stableford points. Raw source: `ios-09-participant-carya-hole1-local-queued-1170x2532.png`, SHA-256 `1dcce1f4f25636e02620175d8e3cdf9a05c6b6dcbf42dcee0ff0edfa21d7a098`. |
| `ios-10-participant-outbox-oracle-pending-390x844.png`       | `c73cf5e2d626d9f97675c38f7b64bbb5788c7665113fcd251398b467f44000b1` | Read-only encrypted-outbox Oracle shows one non-truncated pending mutation and only sanitized SHA-256 fingerprints. Raw source: `ios-10-participant-outbox-oracle-pending-1170x2532.png`, SHA-256 `d244e73078fa184cf8bd4eb5604f28c9035df7f3acc7a77aff4db46bb8a9e26a`.              |

The two final screenshots were opened at original resolution and checked visually. They show the binding Option-2 language: lavender mist background, yellow Crew mark, heavy black outlines, mint primary action, and privacy-safe German copy. Accessibility inspection exposes **Bitte anmelden** as a heading and **Mit E-Mail anmelden** as the button with identifier `private-access-sign-in`.

## Participant Carya read-path assertions

After the separate credential-safe runner opened the redeem URL, the iOS system prompt was confirmed and the native app completed bootstrap through its production mobile code path. This remains a local service-backed native E2E fixture, not a production-environment claim. The Debug client used the generated Gateway boundary at `127.0.0.1:3000`; JavaScript and image assets remained on Metro 8082. No token, redeem URL, Authorization header, or response payload was read into this evidence.

Accessibility inspection asserted the following visible states before each capture:

- Events: heading `Events`; count `1 Event`; button ID `event-evt_local_turkey_golf_2026`; `Turkey Golf Tour 2026`; `4.–11. Oktober 2026`; role `Teilnehmer oder Teilnehmerin`; status `Veröffentlicht`.
- Carya day: heading `Turkey Golf Tour 2026`; `Montag, 5. Oktober` selected; `Offline bereit · gerade synchronisiert`; read-only activity button `08:30, Golf round: Carya Golf Club, Carya Golf Club`.
- Scorecard: heading `Scorekarte`; course `Carya Golf Club`; status `TEILNEHMEND`; `Alle Score-Daten synchronisiert`; `Loch 1 von 18`; selected button ID `golf-hole-1`; `Par 4 · HCP 1`; settable empty fields `golf-strokes-input` and `golf-putts-input`; disabled `golf-save-action`; three-player leaderboard.

No score field was set, no save or sync action was pressed, and no logout was initiated. The simulator was left on selected Hole 1 with both inputs edit-ready for the separately controlled mutation and trace phase.

## Detached local mutation and read-only outbox Oracle

After orchestration reported a cleared allow-listed trace and detached transport, Hole 1 received exactly `Schläge=5` and `Putts=2`, followed by exactly one press of `Loch lokal speichern`. No sync control was pressed.

The UI then asserted:

- `1 Änderung lokal gespeichert` and the explanatory queued-state message;
- selected Hole 1 state `LOKAL GESPEICHERT`;
- strokes `5`, putts `2`, `STABLEFORD · LOKAL` = `2`, `Netto 4`;
- leaderboard row `Du` = 2 points and 1 of 18 holes;
- save button disabled after the exact saved values.

Opening only `crewnext://e2e/outbox/evt_local_turkey_golf_2026` produced this sanitized, read-only Oracle:

```text
pending = 1
attention = 0
truncated = no
pullCursorSha256 = 6429ee4b1d5d75e9ecc2d03de6e867bf5a8ebb4ddb816117b8cf45de3031d8ef
sequence = 1
status = PENDING
kind = golf.score.set
bodySha256 = 1e2e9a08881908fc5a7c4dfae2f1364269fef16b6191afff5c53c01388faa266
requestBodySha256 = unavailable
idempotencyKeySha256 = unavailable
```

No raw command body, request body, idempotency key, token, or private identifier was copied from the Oracle. The app was not terminated or relaunched and remained on the Oracle pending further trace control.

## Safety and evidence boundary

- No simulator reset, device erase, app uninstall, broad Keychain deletion, or whole-service cleanup was performed.
- No Crew Keychain item, session, account database, attachment, or outbox record was deleted. Installation was in place over the existing app.
- A read-only SQLite probe briefly created a zero-byte file named `keychain-2.db` at a nonexistent diagnostic path. Its size was verified as zero and that exact artifact was removed immediately; no Keychain row or database was altered.
- The safe-cleanup phase proves a real signed-out Option-2 surface and stable restart on this iPhone 16e. The later participant phase separately proves service-backed Events, Carya-day, and untouched editable Scorecard readiness.
- A later product-UI step requested a passwordless login for the local participant fixture and stopped at **Anfrage angenommen**. Credential retrieval and redeem were deliberately left to the separate credential-safe runner.
- The Retry-only persistent failure state still needs a safe user escape. Open Bead `crew-paq.3.5.6` tracks an account-guarded, non-broad escape hatch for `PrivateUnavailable`.
