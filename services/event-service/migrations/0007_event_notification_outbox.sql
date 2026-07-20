CREATE TABLE event_notification_outbox (
	id TEXT PRIMARY KEY CHECK (id ~ '^job_[a-f0-9]{32}$'),
	payload_kid TEXT NOT NULL CHECK (payload_kid ~ '^[A-Za-z0-9_-]{1,64}$'),
	payload_ciphertext TEXT NOT NULL CHECK (
		char_length(payload_ciphertext) BETWEEN 32 AND 16384
	),
	expires_at TIMESTAMPTZ NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (
		status IN (
			'pending', 'processing', 'retry', 'delivered', 'suppressed',
			'invalid', 'dead', 'expired'
		)
	),
	attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 32),
	key_failures SMALLINT NOT NULL DEFAULT 0 CHECK (key_failures BETWEEN 0 AND 32),
	available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	lease_owner TEXT CHECK (
		lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128
	),
	lease_until TIMESTAMPTZ,
	fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0),
	outcome_code TEXT CHECK (
		outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
	),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	completed_at TIMESTAMPTZ,
	CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
	CHECK (
		(status = 'processing' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
		(status <> 'processing' AND lease_owner IS NULL AND lease_until IS NULL)
	),
	CHECK (
		(status IN ('delivered', 'suppressed', 'invalid', 'dead', 'expired')
			AND outcome_code IS NOT NULL AND completed_at IS NOT NULL) OR
		(status = 'retry' AND outcome_code IS NOT NULL AND completed_at IS NULL) OR
		(status IN ('pending', 'processing') AND completed_at IS NULL)
	)
);

CREATE INDEX event_notification_outbox_claim_idx
	ON event_notification_outbox(available_at, id)
	WHERE status IN ('pending', 'retry');

CREATE INDEX event_notification_outbox_lease_idx
	ON event_notification_outbox(lease_until, id)
	WHERE status = 'processing';

CREATE FUNCTION event_feed_context_recipient_can_read(
	target_root_event_id TEXT,
	target_event_id TEXT,
	target_user_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT EXISTS (
		WITH RECURSIVE visible AS (
			SELECT event.id FROM events event
			WHERE event.root_event_id = target_root_event_id
				AND event.id = target_root_event_id
				AND event.status = 'published' AND event.deleted_at IS NULL
			UNION ALL
			SELECT child.id FROM events child
			JOIN visible parent ON child.parent_event_id = parent.id
			WHERE child.root_event_id = target_root_event_id
				AND child.status = 'published' AND child.deleted_at IS NULL
		)
		SELECT 1 FROM event_memberships membership
		JOIN event_roots root ON root.root_event_id = membership.root_event_id
		WHERE membership.root_event_id = target_root_event_id
			AND root.status = 'active'
			AND membership.user_id = target_user_id
			AND membership.status = 'active'
			AND EXISTS (
				SELECT 1 FROM events target
				WHERE target.root_event_id = target_root_event_id
					AND target.id = COALESCE(target_event_id, target_root_event_id)
					AND target.deleted_at IS NULL
			)
			AND (
				membership.role IN ('owner', 'organizer') OR
				COALESCE(target_event_id, target_root_event_id) IN (SELECT id FROM visible)
			)
	);
$$;

CREATE FUNCTION event_feed_recipient_can_read(
	target_root_event_id TEXT,
	target_feed_entry_id TEXT,
	target_user_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
	SELECT EXISTS (
		SELECT 1 FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id
			AND current.entry_id = entry.id
		WHERE entry.root_event_id = target_root_event_id
			AND entry.id = target_feed_entry_id
			AND current.deleted_at IS NULL
			AND event_feed_context_recipient_can_read(
				entry.root_event_id, entry.event_id, target_user_id
			)
	);
$$;
