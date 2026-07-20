ALTER TABLE event_idempotency_records
  DROP CONSTRAINT event_idempotency_records_check;

ALTER TABLE event_idempotency_records
  ADD CONSTRAINT event_idempotency_complete_shape CHECK (
    (state = 'processing' AND response_status IS NULL AND response_body IS NULL AND response_headers IS NULL AND completed_at IS NULL) OR
    (state = 'complete' AND response_status BETWEEN 200 AND 499 AND response_body IS NOT NULL AND response_headers IS NOT NULL AND completed_at IS NOT NULL)
  );
