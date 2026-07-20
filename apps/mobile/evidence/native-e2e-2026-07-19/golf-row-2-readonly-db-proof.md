# Golf Row 2 read-only database proof — 2026-07-19

## Scope and safety

- Isolated database: `crew_native_e2e_event_test_0719` on loopback port `5433`.
- Reverse-orientation participant: `usr_59d48c33a9c7418bb58a668bb22137aa`; root event: `evt_local_turkey_golf_2026`; hole: `2`.
- Every query used `PGOPTIONS='-c default_transaction_read_only=on'`, `psql -X`, and `ON_ERROR_STOP=1`; PostgreSQL reported `transaction_read_only = on`.
- No database mutation, secret read, device action, runner/control action, authentication action, or logout was performed.

## Migration and live constraints

The live `event_schema_migrations` row for `0020_golf_scoring.sql` and the source file both have SHA-256:

```text
359a7c8df9e61bed5d3119151b289fb473189de3f39f55ca50ab0b3c5d5e1830
```

The live `event_golf_scores` table reports the migration-defined unique constraint on `(root_event_id, event_id, user_id, hole)`, the round-hole and round-player foreign keys, and checks for score ranges, positive version/root revision, and populated-score net-stroke consistency.

## Exact read-only query

```sql
SELECT count(*)::int AS row_count
FROM event_golf_scores
WHERE root_event_id = 'evt_local_turkey_golf_2026'
  AND user_id = 'usr_59d48c33a9c7418bb58a668bb22137aa'
  AND hole = 2;

SELECT root_event_id, event_id, user_id, hole, strokes, putts,
       playing_handicap, handicap_strokes, net_strokes,
       stableford_points, version, root_revision::text AS root_revision
FROM event_golf_scores
WHERE root_event_id = 'evt_local_turkey_golf_2026'
  AND user_id = 'usr_59d48c33a9c7418bb58a668bb22137aa'
  AND hole = 2;
```

## Result

```text
row_count:          1
root_event_id:      evt_local_turkey_golf_2026
event_id:           evt_local_turkey_golf_2026_round
user_id:            usr_59d48c33a9c7418bb58a668bb22137aa
hole:               2
strokes:            5
putts:              2
playing_handicap:   18
handicap_strokes:   1
net_strokes:        4
stableford_points:  2
version:            1
root_revision:      43
```

A second read-only count without the root-event predicate also returned exactly one row for this participant and hole. The isolated authoritative database therefore contains exactly one Row-2 Hole-2 score with the expected `5/2`, Stableford `2`, and version `1` values.
