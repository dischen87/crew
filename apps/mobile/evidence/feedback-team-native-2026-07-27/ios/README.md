# iOS team-feedback native evidence

Captured on 2026-07-27 with the current Crew source on an iPhone 17 Pro
simulator running iOS 26.2. This is simulator acceptance, not physical-device
or production-signing evidence.

The canonical run is the five passing Maestro flows and matching JUnit reports:

1. `02-open-feedback` opens the event feedback route.
2. `03-capture-preview` captures and retains a real native PNG with consent off.
3. `04-consent-submit-delivered` consents, submits exactly once, automatically
   retries the server verification at `nextAttemptAt`, and reaches
   `ZUGESTELLT` without restarting the app.
4. `05-restart-server-item` performs a real stop/start, refreshes the canonical
   server list, and finds `Team iOS Delivery 0727`.
5. `06-logout` visibly signs out and leaves zero retained PNG files.

The three screenshots record the delivered receipt, cold-restart server item,
and signed-out result. `oracles/server-readback.json` records the matching
feedback/attachment binding, committed upload, object-store size/hash checks,
and logout purge count.

## Storage-denial recovery extension

The current `a21a6739a2ad5dfd94ef0492b7ccf52803504099` source also passed
`07-storage-denial-text-recovery` on a disposable iPhone 16e simulator:

The Debug executable SHA-256 was
`be55ceb73798b5cf8f34547cd38b4caaa0ccd1c00dbc1531f62d638a7591fdca`;
the app loaded current workspace JavaScript from the isolated Metro port 8082.

1. The active account-private attachment directory was made read-only through
   the simulator filesystem before the explicit screenshot action.
2. Native retention failed without a preview, retained file, or temporary file.
3. The product showed only the safe text-recovery copy and kept normal
   text-feedback enabled.
4. The user entered text and reached the server-confirmed `ZUGESTELLT` receipt.
5. Directory permissions were restored after the assertion.

The zero-failure report is
`reports/07-storage-denial-text-recovery.xml`; screenshots 07 and 08 show the
safe fallback and delivered text-only receipt. The sanitized external count
oracle is `oracles/storage-denial-text-recovery.json`.

iOS has no Photos-style OS permission prompt for capturing app-owned content.
This run therefore claims a real filesystem storage denial, not an invented
screen-capture permission denial. Background, secure-window, and physical-device
failure paths remain unclaimed.

Failed exploratory runs and retry-only flows are intentionally excluded. The
reports contain no tokens, email addresses, absolute host paths, or local
device identifiers.
