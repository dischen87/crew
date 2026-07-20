CREATE INDEX event_notification_outbox_terminal_retention_idx
	ON event_notification_outbox(completed_at, id)
	WHERE status IN ('delivered', 'suppressed', 'invalid', 'dead', 'expired');
