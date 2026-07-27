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

Failed exploratory runs and retry-only flows are intentionally excluded. The
reports contain no tokens, email addresses, absolute host paths, or local
device identifiers.
