# iOS golf row read-only database proof — 2026-07-19

## Scope and safety

- Isolated database: `crew_native_e2e_event_test_0719` on the native E2E PostgreSQL instance at loopback port 5433.
- Target participant: `usr_0bc9a411b00a489385b7582a0cdbbd7d`; target hole: `1`.
- Every `psql` connection used `PGOPTIONS='-c default_transaction_read_only=on'`, `-X`, and `ON_ERROR_STOP=1`.
- The database confirmed `transaction_read_only=on` before inspection.
- No database mutation, secret read, app interaction, sync action, logout, or simulator action was performed for this proof.

## Migration and live schema check

The database migration ledger contains:

```text
name:     0020_golf_scoring.sql
checksum: 359a7c8df9e61bed5d3119151b289fb473189de3f39f55ca50ab0b3c5d5e1830
```

That checksum exactly matches the source file:

```text
services/event-service/migrations/0020_golf_scoring.sql
SHA-256 359a7c8df9e61bed5d3119151b289fb473189de3f39f55ca50ab0b3c5d5e1830
```

The live `event_golf_scores` table exposes the migration-defined score columns. The database also reports the expected unique constraint on `(root_event_id, event_id, user_id, hole)`, the round-hole and round-player foreign keys, and checks for score ranges, positive version/root revision, and `net_strokes = strokes - handicap_strokes` for a populated score.

## Exact read-only query

```sql
SELECT count(*)::int AS row_count
FROM event_golf_scores
WHERE user_id = 'usr_0bc9a411b00a489385b7582a0cdbbd7d'
  AND hole = 1;

SELECT
  root_event_id,
  event_id,
  user_id,
  hole,
  strokes,
  putts,
  playing_handicap,
  handicap_strokes,
  net_strokes,
  stableford_points,
  version,
  root_revision::text AS root_revision
FROM event_golf_scores
WHERE user_id = 'usr_0bc9a411b00a489385b7582a0cdbbd7d'
  AND hole = 1
ORDER BY root_event_id, event_id;
```

## Result

```text
row_count:          1
root_event_id:      evt_local_turkey_golf_2026
event_id:           evt_local_turkey_golf_2026_round
user_id:            usr_0bc9a411b00a489385b7582a0cdbbd7d
hole:               1
strokes:            5
putts:              2
playing_handicap:   18
handicap_strokes:   1
net_strokes:        4
stableford_points:  2
version:            1
root_revision:      43
```

The isolated service database therefore contains exactly one Hole-1 score row for the participant, and its authoritative values match the server-confirmed iPhone Scorecard state.
