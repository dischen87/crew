WITH receipt_roles AS (
  SELECT
    actor_id,
    CASE result->'entity'->>'entityType'
      WHEN 'golfRound' THEN 'owner'
      WHEN 'golfScore' THEN 'participant'
      ELSE 'unexpected'
    END AS role,
    result->'entity'->>'entityType' AS entity_type,
    outcome,
    client_sequence
  FROM event_sync_mutation_receipts
), receipt_summary AS (
  SELECT
    role,
    entity_type,
    outcome,
    count(*)::int AS receipts,
    min(client_sequence)::int AS minimum_sequence,
    max(client_sequence)::int AS maximum_sequence
  FROM receipt_roles
  GROUP BY role, entity_type, outcome
), idempotency_summary AS (
  SELECT
    roles.role,
    count(*)::int AS records,
    count(*) FILTER (WHERE record.state = 'complete')::int AS complete_records
  FROM event_idempotency_records AS record
  JOIN (
    SELECT DISTINCT actor_id, role
    FROM receipt_roles
  ) AS roles USING (actor_id)
  WHERE record.operation_id = 'syncMutationsApply'
  GROUP BY roles.role
)
SELECT json_build_object(
  'mutationReceipts',
    (
      SELECT json_agg(receipt_summary ORDER BY role)
      FROM receipt_summary
    ),
  'syncIdempotency',
    (
      SELECT json_agg(idempotency_summary ORDER BY role)
      FROM idempotency_summary
    ),
  'score',
    (
      SELECT row_to_json(score)
      FROM (
        SELECT
          count(*)::int AS rows,
          min(hole)::int AS hole,
          min(strokes)::int AS strokes,
          min(putts)::int AS putts,
          min(stableford_points)::int AS stableford_points,
          min(version)::int AS minimum_version,
          max(version)::int AS maximum_version
        FROM event_golf_scores
      ) AS score
    )
);
