CREATE TABLE place_enrichment_job_associations (
	job_id TEXT NOT NULL REFERENCES place_enrichment_jobs(id) ON DELETE CASCADE,
	actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
	root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
	reserved_cost_micros INTEGER NOT NULL CHECK (
		reserved_cost_micros BETWEEN 0 AND 1000000
	),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	PRIMARY KEY (job_id, actor_id, root_event_id)
);

CREATE UNIQUE INDEX place_enrichment_associations_charged_once_idx
	ON place_enrichment_job_associations(job_id)
	WHERE reserved_cost_micros > 0;

CREATE INDEX place_enrichment_associations_actor_day_idx
	ON place_enrichment_job_associations(actor_id, created_at)
	INCLUDE (reserved_cost_micros)
	WHERE reserved_cost_micros > 0;

CREATE INDEX place_enrichment_associations_global_day_idx
	ON place_enrichment_job_associations(created_at)
	INCLUDE (reserved_cost_micros)
	WHERE reserved_cost_micros > 0;

CREATE INDEX place_enrichment_jobs_active_admission_idx
	ON place_enrichment_jobs(id)
	WHERE status IN ('pending', 'processing', 'retry');
