ALTER TABLE event_attachments
  DROP CONSTRAINT event_attachments_version_one;

DROP TRIGGER event_attachments_immutable ON event_attachments;
DROP FUNCTION reject_event_attachment_mutation();

CREATE FUNCTION reject_event_attachment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  RAISE EXCEPTION 'Committed attachment identity is immutable'
    USING ERRCODE = '23514';
END;
$body$;

CREATE TRIGGER event_attachments_immutable
  BEFORE UPDATE ON event_attachments
  FOR EACH ROW EXECUTE FUNCTION reject_event_attachment_update();
