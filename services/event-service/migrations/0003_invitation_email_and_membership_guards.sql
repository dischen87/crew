ALTER TABLE event_invitations
  ADD COLUMN normalized_email_hint TEXT;

ALTER TABLE event_invitations
  ADD CONSTRAINT event_invitation_email_hint_shape CHECK (
    normalized_email_hint IS NULL OR (
      normalized_email_hint = lower(btrim(normalized_email_hint)) AND
      char_length(normalized_email_hint) BETWEEN 3 AND 254 AND
      normalized_email_hint LIKE '%@%'
    )
  );

CREATE FUNCTION prevent_membership_root_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.root_event_id IS DISTINCT FROM OLD.root_event_id THEN
    RAISE EXCEPTION 'membership root_event_id is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_root_immutable
  BEFORE UPDATE OF root_event_id ON event_memberships
  FOR EACH ROW EXECUTE FUNCTION prevent_membership_root_change();
