CREATE TABLE place_enrichment_job_scopes (
	job_id TEXT NOT NULL,
	actor_id TEXT NOT NULL,
	root_event_id TEXT NOT NULL,
	event_id TEXT NOT NULL,
	capability_type TEXT NOT NULL CHECK (
		capability_type IN ('travel', 'lodging', 'transport', 'golf', 'team')
	),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	PRIMARY KEY (
		job_id, actor_id, root_event_id, event_id, capability_type
	),
	FOREIGN KEY (job_id, actor_id, root_event_id)
		REFERENCES place_enrichment_job_associations(
			job_id, actor_id, root_event_id
		)
		ON DELETE CASCADE,
	FOREIGN KEY (root_event_id, event_id)
		REFERENCES events(root_event_id, id)
);

CREATE TABLE place_enrichment_reviews (
	job_id TEXT PRIMARY KEY REFERENCES place_enrichment_jobs(id) ON DELETE CASCADE,
	actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
	root_event_id TEXT NOT NULL,
	event_id TEXT NOT NULL,
	capability_type TEXT NOT NULL CHECK (
		capability_type IN ('travel', 'lodging', 'transport', 'golf', 'team')
	),
	decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
	candidate_id TEXT REFERENCES place_candidates(id),
	decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	FOREIGN KEY (
		job_id, actor_id, root_event_id, event_id, capability_type
	) REFERENCES place_enrichment_job_scopes(
		job_id, actor_id, root_event_id, event_id, capability_type
	),
	CHECK (
		(decision = 'approve' AND candidate_id IS NOT NULL)
		OR (decision = 'reject' AND candidate_id IS NULL)
	)
);
