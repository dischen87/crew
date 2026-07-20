CREATE TABLE global_places (
	id TEXT PRIMARY KEY CHECK (id ~ '^gpl_[a-f0-9]{64}$'),
	candidate_id TEXT NOT NULL UNIQUE REFERENCES place_candidates(id),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
