ALTER TABLE event_recap_external_grant_decisions
  DROP CONSTRAINT event_recap_external_grant_decisions_field_name_check,
  ADD CONSTRAINT event_recap_external_grant_decisions_field_name_check CHECK (
    field_name = 'body' OR
    field_name ~ '^caption\|att_[A-Za-z0-9._:-]{1,96}\|[1-9][0-9]{0,9}$'
  );

ALTER TABLE event_recap_external_share_fields
  DROP CONSTRAINT event_recap_external_share_fields_field_name_check,
  ADD CONSTRAINT event_recap_external_share_fields_field_name_check CHECK (
    field_name = 'body' OR
    field_name ~ '^caption\|att_[A-Za-z0-9._:-]{1,96}\|[1-9][0-9]{0,9}$'
  );
