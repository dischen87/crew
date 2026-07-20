CREATE INDEX event_memberships_actor_active_roots_idx
  ON event_memberships(user_id, root_event_id)
  WHERE status = 'active';
