# Team-feedback native acceptance

Fresh Crew team-event acceptance captured on 2026-07-27.

| Platform | Native capture | Delivery | Cold restart readback | Logout purge | Failure → text-only |
| --- | --- | --- | --- | --- | --- |
| Android API 36 emulator | PASS | PASS after durable queue resume | PASS | PASS, 0 retained PNGs | Not rerun here |
| iOS 26.2 simulator | PASS | PASS via scheduled verification retry | PASS | PASS, 0 retained PNGs | PASS, real storage denial |

Each platform folder contains only canonical passing flows, zero-failure JUnit
reports, screenshots, a server/object-store oracle, and platform limitations.
Earlier failed runs, poisoned queues, expired grants, and pending-only
screenshots are excluded.

This packet proves simulator/emulator behavior against an isolated fresh Crew
fixture. It does not claim physical-device accessibility acceptance,
production signing, or a production deployment.

The iOS failure-recovery extension was captured from current clean main
`a21a6739a2ad5dfd94ef0492b7ccf52803504099`. It retained no account identifier,
private path, filename, device identifier, credential, or raw log. Full Android
A → B account-switch isolation remains independently proven in the sibling
`feedback-android-logout-isolation-2026-07-27` packet; no fresh iOS account-switch
claim is added here.
