CREATE TABLE event_feedback_follows (
  root_event_id TEXT NOT NULL,
  feedback_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, user_id),
  FOREIGN KEY (root_event_id, feedback_id)
    REFERENCES event_feedback(root_event_id, id)
);

CREATE INDEX event_feedback_follows_actor_idx
  ON event_feedback_follows(user_id, root_event_id, feedback_id);

CREATE INDEX event_feedback_community_order_idx
  ON event_feedback(root_event_id, updated_at DESC, id DESC)
  WHERE visibility = 'public' AND status <> 'duplicate';

CREATE INDEX event_feedback_community_status_order_idx
  ON event_feedback(root_event_id, status, updated_at DESC, id DESC)
  WHERE visibility = 'public' AND status <> 'duplicate';

CREATE INDEX event_feedback_duplicate_group_idx
  ON event_feedback(duplicate_of_feedback_id, id)
  WHERE visibility = 'public' AND status = 'duplicate';

CREATE INDEX event_feedback_public_updates_idx
  ON event_feedback_status_history(changed_at DESC, feedback_id DESC, version DESC)
  WHERE from_status IS NOT NULL;

-- feedback replay normalization begin
WITH legacy_feedback_replays AS (
  SELECT actor_id, operation_id, idempotency_key, response_body,
    CASE
      WHEN jsonb_typeof(response_body #> '{feedback,commentCount}') = 'number'
        THEN (response_body #>> '{feedback,commentCount}')::integer
      ELSE jsonb_array_length(response_body #> '{feedback,comments}')
    END AS comment_count,
    CASE
      WHEN jsonb_typeof(response_body #> '{feedback,statusHistoryCount}') = 'number'
        THEN (response_body #>> '{feedback,statusHistoryCount}')::integer
      ELSE jsonb_array_length(response_body #> '{feedback,statusHistory}')
    END AS history_count,
    (
      SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(response_body #> '{feedback,comments}')
        WITH ORDINALITY AS item(value, ordinal)
      WHERE ordinal > GREATEST(
        jsonb_array_length(response_body #> '{feedback,comments}') - 20,
        0
      )
    ) AS comments,
    (
      SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(response_body #> '{feedback,statusHistory}')
        WITH ORDINALITY AS item(value, ordinal)
      WHERE ordinal > GREATEST(
        jsonb_array_length(response_body #> '{feedback,statusHistory}') - 20,
        0
      )
    ) AS history
  FROM event_idempotency_records
  WHERE state = 'complete' AND response_status BETWEEN 200 AND 299
    AND operation_id IN (
      'feedbackCreate',
      'feedbackVotesSet',
      'feedbackCommentsCreate',
      'feedbackDuplicateMark',
      'feedbackStatusSet'
    )
    AND jsonb_typeof(response_body -> 'feedback') = 'object'
    AND jsonb_typeof(response_body #> '{feedback,comments}') = 'array'
    AND jsonb_typeof(response_body #> '{feedback,statusHistory}') = 'array'
), normalized_feedback_replays AS (
  SELECT actor_id, operation_id, idempotency_key,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                response_body,
                '{feedback,comments}', comments, false
              ),
              '{feedback,commentCount}', to_jsonb(comment_count), true
            ),
            '{feedback,commentsHasMore}',
            to_jsonb(comment_count > jsonb_array_length(comments)), true
          ),
          '{feedback,statusHistory}', history, false
        ),
        '{feedback,statusHistoryCount}', to_jsonb(history_count), true
      ),
      '{feedback,statusHistoryHasMore}',
      to_jsonb(history_count > jsonb_array_length(history)), true
    ) AS response_body
  FROM legacy_feedback_replays
)
UPDATE event_idempotency_records AS record
SET response_body = normalized.response_body
FROM normalized_feedback_replays AS normalized
WHERE record.actor_id = normalized.actor_id
  AND record.operation_id = normalized.operation_id
  AND record.idempotency_key = normalized.idempotency_key;
-- feedback replay normalization end
