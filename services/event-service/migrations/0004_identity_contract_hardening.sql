ALTER TABLE event_memberships
  ADD CONSTRAINT event_membership_user_id_shape
  CHECK (user_id ~ '^usr_[a-f0-9]{32}$');

ALTER TABLE event_memberships
  ADD CONSTRAINT event_membership_removed_by_shape
  CHECK (removed_by IS NULL OR removed_by ~ '^usr_[a-f0-9]{32}$');

ALTER TABLE event_invitations
  ADD CONSTRAINT event_invitation_created_by_shape
  CHECK (created_by ~ '^usr_[a-f0-9]{32}$');

ALTER TABLE event_invitation_redemptions
  ADD CONSTRAINT event_redemption_user_id_shape
  CHECK (user_id ~ '^usr_[a-f0-9]{32}$');

ALTER TABLE event_idempotency_records
  ADD CONSTRAINT event_idempotency_actor_id_shape
  CHECK (actor_id ~ '^usr_[a-f0-9]{32}$');
