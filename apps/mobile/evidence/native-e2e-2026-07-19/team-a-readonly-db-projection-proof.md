# Team Orientation A read-only database projection proof — 2026-07-19

## Scope and safety

- Isolated database: `crew_native_e2e_event_test_0719` on loopback port `5433`.
- Root: `evt_local_team_day_2026`; participant: `usr_ea0e3166e4cc43d68b29ec31377d3f6a`.
- Exact body: `Participant reconnect check: option B is ready.`
- Every query used `PGOPTIONS='-c default_transaction_read_only=on'`, `psql -X`, and `ON_ERROR_STOP=1`; PostgreSQL reported `transaction_read_only = on`.
- No database mutation, secret read, device, runner/control, or authentication action was performed.

## Exact authoritative result

The exact root, author, and body predicate returned one current feed row:

```text
row_count:             1
entry_id:              fed_8c2c688e-be13-499e-bfee-30548f95c94e
root_event_id:         evt_local_team_day_2026
event_id:              NULL
author_user_id:        usr_ea0e3166e4cc43d68b29ec31377d3f6a
kind:                  message
body:                  Participant reconnect check: option B is ready.
version:               1
created_root_revision: 22
current_root_revision: 22
deleted_at:            NULL
```

The revision table contains exactly the version-`1` body at root revision `22`.
The current row is therefore a root-feed entry (`event_id IS NULL`), not a
descendant-event projection.

## Pull projection and receipt

- The participant's unexpired bootstrap snapshot is at revision `21`, scope
  version `14`, and correctly contains zero records for this later entry.
- Strictly after that snapshot checkpoint, `event_root_changes` contains exactly
  one change: the target `feedEntry` upsert at `(22, 0)`, version `1`, audience
  `members`, with the exact body in `payload.text`.
- The participant's matching mutation receipt is `applied`, client sequence `1`,
  references the target entry, and reports result root revision `22`.
- Root revision is `22`; the minimum sync cursor is `0:-1`. No visibility or
  cursor-expiry condition excludes the change.

## Honest boundary

This proof establishes only the isolated service database state, sync
projection, pull window, and applied receipt. It does not by itself prove the
native UI, cold-restart persistence, transport suppression/replay, Oracle
state, or the independent owner's readback; those require their separate
device screenshots and runner traces.
