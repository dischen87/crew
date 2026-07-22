ALTER TABLE event_recap_external_grant_decisions
  DROP CONSTRAINT event_recap_external_grant_decisions_field_name_check,
  ADD CONSTRAINT event_recap_external_grant_decisions_field_name_check CHECK (
    field_name = 'body' OR (
      source_type = 'feedEntry' AND
      field_name ~ '^caption\|att_[A-Za-z0-9._:-]{1,96}\|[1-9][0-9]{0,9}$'
    )
  );

ALTER TABLE event_recap_external_share_fields
  DROP CONSTRAINT event_recap_external_share_fields_field_name_check,
  ADD CONSTRAINT event_recap_external_share_fields_field_name_check CHECK (
    field_name = 'body' OR (
      source_type = 'feedEntry' AND
      field_name ~ '^caption\|att_[A-Za-z0-9._:-]{1,96}\|[1-9][0-9]{0,9}$'
    )
  );

ALTER TABLE event_attachments
  ADD CONSTRAINT event_attachments_version_one CHECK (version = 1);

CREATE FUNCTION reject_event_attachment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.target_type = 'feedback' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Committed attachment identity is immutable'
    USING ERRCODE = '23514';
END;
$body$;

CREATE TRIGGER event_attachments_immutable
  BEFORE UPDATE OR DELETE ON event_attachments
  FOR EACH ROW EXECUTE FUNCTION reject_event_attachment_mutation();
