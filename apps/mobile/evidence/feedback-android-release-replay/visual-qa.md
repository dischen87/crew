# Visual and privacy QA

## Captures

- `release-crypto-proof`: exact Release-evidence APK with a sanitized boolean
  crypto shape. The fixture Events screen remains visibly behind the native
  dialog.
- `fifth-cold-launch-events`: the fifth cold process returned to the real
  Design 2 Events shell after delivery without another feedback request.

Both raw captures are `1080x2400`; review copies are `412x915`. The Events
screen retains the bound Crew Board visual system, readable hierarchy, complete
controls, and no clipped content at the tested default text scale.

## Deliberate limits

The screenshots do not prove queue state or server exact-once behavior; the
sanitized runner trace and read-only database aggregates do. No composer image
after typing was retained, so the report payload cannot leak through pixels or
accessibility semantics. The final Events semantics retains only the
deterministic fixture route selector, not a generated user, feedback, device,
request, or idempotency identity.
