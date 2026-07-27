# Android Team Feedback native evidence

Canonical Android acceptance packet for the fresh Crew project. It contains only
the successful run; earlier diagnostics and failed attempts are intentionally
excluded.

## Provenance

- Date: 2026-07-27
- Device: disposable Android API 36 emulator, 1080 × 2400
- Native shell revision at APK build time:
  `9e2d70c0cc367085d48cc80db5e739bc813580e7`
- Installed debug APK SHA-256:
  `158b75277b6c043ae5e63444607420de1231041d3bd163b2eb7d94c044e5346a`
- JavaScript bundle: current workspace source committed alongside this packet
- Fixture: fresh participant in `evt_local_team_day_2026`
- Request identity: `crew-e2e.android`

The APK hash identifies the tested native shell; the debug JavaScript source is
the source committed with this packet. The evidence contains no credentials,
authorization headers, signed upload URLs, tunnel hostnames, fixture e-mail
addresses, host paths, or database/object-store identifiers.

## Result

| Step | Native assertion | Result |
| --- | --- | --- |
| 01 | Direct Team Feedback link opens from a fresh, cold-cache participant session | PASS |
| 02 | Native screenshot capture is previewed locally and consent starts off | PASS |
| 03 | Screenshot consent can be enabled and the feedback is ready to submit | PASS |
| 04 | The one submitted item reaches `DELIVERED`; its upload reaches `COMMITTED`; screenshot binding and metadata match | PASS |
| 05 | A full app stop/start reloads the server-backed feedback item | PASS |
| 06 | Logout returns to the signed-out private-access screen | PASS |

Each row has a matching flow under `flows/`, a zero-failure JUnit report under
`reports/`, and a numbered screenshot under `screenshots/`.

The native capture produced one retained PNG with SHA-256
`137a7cbf2e8dc75940c8633d6c6debb7786fbc9addc64e35fc5891e33f6d79b5`.
The sanitized server oracle in `oracles/server-readback.json` records one feedback
row, one attachment link, one event attachment, one committed participant upload,
and the same 652292-byte PNG hash in both database metadata and committed object
storage. The gateway forwarded feedback creation once with HTTP 201 and did not
replay it.

## Delivery and cleanup notes

The submit control was tapped exactly once. Its first foreground delivery attempt
entered `PENDING` after a transient `service_unavailable`; a clean app restart
resumed the existing queue and delivered it, without a second submit. The
delivered outbox evidence and the independent server oracle confirm the final
state. Flow 05 then performs another explicit stop/start and proves the committed
server item remains visible.

Committed-media reconciliation had already reduced retained local PNGs from one
to zero before the final logout. Flow 06 proves the signed-out state after logout.
The encrypted database container remains on disk by design; logout invokes the
private-user-data clearing contract rather than deleting the database files.

Preflight failures caused by a full disposable object store and by reuse of an
expired prepared-upload identity were resolved before this fresh run. Their
screenshots and reports are not part of this canonical PASS packet.
