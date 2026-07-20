# HEIC normalization and retained-file reconciliation evidence

Captured 2026-07-18 on Xcode 26.3 (17C519), iOS 26.2, iPhone 17 Pro
Simulator.

## Build and registration

From the workspace root and `apps/mobile/ios` respectively:

```sh
node node_modules/react-native/scripts/generate-codegen-artifacts.js \
  -p apps/mobile -t ios -o apps/mobile/ios
xcodebuild -quiet -workspace CrewNext.xcworkspace -scheme CrewNext \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=4E5175BD-8D1F-4F61-BE12-2FDB8D6AB8AC' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -quiet -workspace CrewNext.xcworkspace -scheme CrewNext \
  -configuration Release \
  -destination 'platform=iOS Simulator,id=4E5175BD-8D1F-4F61-BE12-2FDB8D6AB8AC' \
  CODE_SIGNING_ALLOWED=NO build
```

All three commands exited `0`. Codegen generated both native methods in
`CrewAttachmentMediaSpec`. Debug and Release linked the app-local TurboModule.
Only existing React Native dependency/build-script warnings remained.

The normal Release app was installed and launched after the smoke. It produced
no fatal, exception, runtime-not-ready, or TurboModule log. It was then
terminated; the unrelated Metro process in another workspace was left running.

## Stable-source and reconciliation smoke

A temporary copy of the Release app received HEIC and JPEG fixtures. The
repeatable entry is `evidence/attachment-media-smoke-entry.js`.

```sh
sips -Z 1024 -s format heic \
  evidence/auth-invite-event-switching/01-current.png \
  --out "$SMOKE_APP/smoke.heic"
sips -Z 1024 -s format jpeg \
  evidence/auth-invite-event-switching/01-current.png \
  --out "$SMOKE_APP/smoke.jpg"
sips -Z 800 -s format jpeg \
  evidence/auth-invite-event-switching/02-sign-in.png \
  --out "$SMOKE_APP/smoke-orphan.jpg"
node ../../node_modules/react-native/scripts/bundle.js \
  --config-cmd "node ../../node_modules/react-native/cli.js config" \
  --entry-file evidence/attachment-media-smoke-entry.js \
  --platform ios --dev false --minify false \
  --bundle-output "$SMOKE_APP/main.jsbundle" --assets-dest "$SMOKE_APP"
xcrun simctl install "$DEVICE_ID" "$SMOKE_APP"
```

The cleanup fixtures and all three grace phases are reproducible without
retaining an app-container UUID:

```sh
DATA_CONTAINER="$(xcrun simctl get_app_container \
  "$DEVICE_ID" app.crew.next data)"
ACCOUNT_DIR="$DATA_CONTAINER/Library/Application Support/CrewAttachments/\
usr_77777777777777777777777777777777"
mkdir -p "$ACCOUNT_DIR"
cp "$SMOKE_APP/smoke.jpg" "$ACCOUNT_DIR/.crash.source.tmp"
cp "$SMOKE_APP/smoke.jpg" \
  "$ACCOUNT_DIR/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"
touch -t 202607181200.00 \
  "$ACCOUNT_DIR/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg"

# Phase 1: stale temp/final disappear; the fresh unreferenced final stays.
xcrun simctl launch --terminate-running-process "$DEVICE_ID" app.crew.next

# Phase 2: even a future mtime is conservatively preserved.
xcrun simctl terminate "$DEVICE_ID" app.crew.next
touch -t 202701010000.00 \
  "$ACCOUNT_DIR/1d6095857eea13c9e62959423b1d4f4e0a6010dfd51a2ed8aa88ff7bbd10ea7b.jpg"
xcrun simctl launch "$DEVICE_ID" app.crew.next

# Phase 3: the same unreferenced final is removed once clearly older than grace.
xcrun simctl terminate "$DEVICE_ID" app.crew.next
touch -t 202607181200.00 \
  "$ACCOUNT_DIR/1d6095857eea13c9e62959423b1d4f4e0a6010dfd51a2ed8aa88ff7bbd10ea7b.jpg"
xcrun simctl launch "$DEVICE_ID" app.crew.next
```

The entry normalized the HEIC, retained the main JPEG, retained a third JPEG as
a simulated DB-failure orphan, then called `reconcileRetained` with only the two
referenced DB keys.

| Case | Source | Retained result | Invariant |
| --- | --- | --- | --- |
| HEIC normalize | 12,972 B; 471 x 1024; SHA-256 `8997b9867dff7411b9691ccca486d78a39cf30ae47dca301829b0e6abe642b3a` | JPEG; 30,315 B; 471 x 1024; SHA-256/file key `9a7933dd7b84f3374a3e717277d4c586c0909a8ce390aacf297d53adcde8af86.jpg` | ImageIO read the private snapshot; hash and byte count describe the retained JPEG. |
| JPEG pass-through | 28,742 B; 471 x 1024; SHA-256 `f205975bd51383e1e5dea3d40c54433f8887aec376d59f9be4834440374265fb` | JPEG; 28,742 B; 471 x 1024; identical SHA-256/file key | The exact private snapshot validated by ImageIO was hashed and moved. |
| Reconcile orphan | 46,091 B JPEG; SHA-256/file key `1d6095857eea13c9e62959423b1d4f4e0a6010dfd51a2ed8aa88ff7bbd10ea7b.jpg` | Fresh and future-mtime phases preserved it; clearly old phase removed it | A stale DB snapshot cannot delete a just-retained final, while an aged DB-failure orphan is eventually removed. |

Phase 1 removed the stale `.tmp` and old synthetic final immediately but kept
the fresh unreferenced final. Phase 2 kept that final with a future mtime. Phase
3 removed it after its mtime was set clearly beyond the five-minute grace. Both
referenced files kept the same SHA-256, byte count, inode, and modification time
through every relaunch:

- Normalized HEIC output: inode `81202146`, 30,315 B, mtime `1784412981`.
- Pass-through JPEG: inode `81202147`, 28,742 B, mtime `1784412981`.

The native module first copies the provider URL into a unique protected private
temp file. ImageIO type/frame/dimension validation, HEIF decode, pass-through
hashing, and the final move use only that stable snapshot. Reconciliation runs
after SQLite migration and before private navigation becomes ready. It receives
`SELECT DISTINCT retained_file_key` for the active account and executes on the
same serial native queue as normalization, so removing all crash `.tmp` files
cannot overlap a native retain. Every attachment prepare also awaits this sweep
before starting normalization. Retention explicitly sets final-file mtime to
the current time, including pass-through photos whose source metadata is old.
An unreferenced final is removed only when its mtime is at least five minutes
old; fresh, clock-skewed, and future mtimes are preserved. Finals referenced by
one or more DB rows are always preserved, and `SELECT DISTINCT` makes multiple
same-byte attachments safe.

## Runtime outbox and DB-failure evidence

The mobile-data integration test deliberately adds top-level and nested
`sourceUri`, `bytes`, and `retainedFileKey` properties to an
`attachment.commit`. It proves that `mutation_outbox.command_json` contains
only canonical mutation identity plus
`{kind, entityId, payload: {uploadId, caption}}`, closes and reopens SQLite,
then proves the Gateway push contains the same canonical mutation and none of
the injected fields.

One app test blocks the first DB retain, starts a second prepare with the stale
DB-reference snapshot, and proves the fresh first final survives until both DB
rows commit. Another simulates native retention followed by a failed SQLite
insert, preserves the fresh orphan during grace, advances beyond five minutes,
then proves the next bootstrap removes it while retaining a referenced key.
Bootstrap tests prove reconciliation runs after migration and before `ready`;
the mobile-data restart test proves duplicate attachment rows produce one
distinct retained file key.

Final automated gates:

- Mobile app: 16 Jest suites, 57 tests; TypeScript and ESLint passed.
- Mobile data: 28 tests, 211 expectations; TypeScript and Biome passed.
- React Native codegen, Debug build, Release build, `git diff --check`, Beads
  lint, and dependency-cycle checks passed.

Account logout cleanup remains separate: startup reconciliation cleans the
active account, but an account that is logged out and never opened again can
retain its protected directory. A DB-failure orphan is eligible for deletion
after five minutes and is removed by the first later bootstrap or attachment
prepare. If neither ever occurs, it remains protected but cannot accumulate
further without another prepare.

## Not proven

- A real iPhone camera HEIC, including orientation metadata.
- Picker cancellation behavior.
- Low-storage and file-protection behavior on a physical device.
- Account-media deletion on logout.

These remain device acceptance work; this evidence does not justify closing
`crew-paq.3.7`.
