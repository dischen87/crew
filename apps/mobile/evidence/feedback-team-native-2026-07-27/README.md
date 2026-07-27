# Team-feedback native acceptance

Fresh Crew team-event acceptance captured on 2026-07-27.

| Platform | Native capture | Delivery | Cold restart readback | Logout purge |
| --- | --- | --- | --- | --- |
| Android API 36 emulator | PASS | PASS after durable queue resume | PASS | PASS, 0 retained PNGs |
| iOS 26.2 simulator | PASS | PASS via scheduled verification retry | PASS | PASS, 0 retained PNGs |

Each platform folder contains only canonical passing flows, zero-failure JUnit
reports, screenshots, a server/object-store oracle, and platform limitations.
Earlier failed runs, poisoned queues, expired grants, and pending-only
screenshots are excluded.

This packet proves simulator/emulator behavior against an isolated fresh Crew
fixture. It does not claim physical-device accessibility acceptance,
production signing, or a production deployment.
