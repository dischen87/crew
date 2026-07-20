# Team Orientation B read-only database projection proof — 2026-07-19

## Scope and safety

- Isolated database: `crew_native_e2e_event_test_0719` on loopback port `5433`.
- Root: `evt_local_team_day_2026`; participant: `usr_ea0e3166e4cc43d68b29ec31377d3f6a`.
- Exact body: `iOS participant reconnect check: orientation B is ready.`
- Every query used `PGOPTIONS='-c default_transaction_read_only=on'`, `psql -X`, and `ON_ERROR_STOP=1`; PostgreSQL reported `transaction_read_only = on`.
- No database mutation, secret read, device, runner/control, or authentication action was performed.

## Exact authoritative result

The exact root, author, and body predicate returned one current feed row:

```text
row_count:             1
entry_id:              fed_9d1c999b-c0fe-4dce-ae2e-cd1599ff704b
root_event_id:         evt_local_team_day_2026
event_id:              NULL
author_user_id:        usr_ea0e3166e4cc43d68b29ec31377d3f6a
kind:                  message
body:                  iOS participant reconnect check: orientation B is ready.
version:               1
created_root_revision: 23
current_root_revision: 23
deleted_at:            NULL
```

The revision table contains exactly one version-`1`, non-tombstoned revision
with the exact body at root revision `23`. The current row is therefore a
root-feed entry (`event_id IS NULL`), not a descendant-event projection.

## Pull projection and receipt

- The author has one active participant membership at version `1`.
- The participant's one unexpired bootstrap snapshot is at revision `22`,
  authorization scope version `14`, with `30` records.
- Strictly after that snapshot checkpoint, the participant-visible pull window
  contains exactly one change: the target `feedEntry` upsert at `(23, 0)`,
  version `1`, audience `members`, with the exact body in `payload.text`.
- Exactly one matching mutation receipt is `applied`, client sequence `1`,
  references the target `feedEntry` at version `1`, and reports result root
  revision `23`.
- Root revision is `23`; the minimum sync cursor is `0:-1`. No scope or cursor
  expiry condition excludes the target change.

## Orientation separation

Orientation A remains a distinct undeleted version-`1` row at revision `22`:

```text
Orientation A body: Participant reconnect check: option B is ready.
Orientation A entry: fed_8c2c688e-be13-499e-bfee-30548f95c94e
Orientation A count: 1
Orientation B entry: fed_9d1c999b-c0fe-4dce-ae2e-cd1599ff704b
Orientation B count: 1
```

The revision-`22` snapshot contains the Orientation-A entry once and contains
no Orientation-B entry. The sole member-visible change after that checkpoint is
the distinct Orientation-B entry at revision `23`, preventing body or row
conflation between the two orientations.

## Honest boundary

This proof establishes only the isolated service database state, sync
projection, pull window, applied receipt, and separation from Orientation A. It
does not by itself prove native restart persistence, transport
suppression/replay, Oracle state, the owner's UI readback, logout, runtime
cleanup, accessibility, or final validation gates; those remain separate
artifacts.
