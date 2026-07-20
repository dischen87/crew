CREATE TABLE event_golf_rounds (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  capability_type TEXT GENERATED ALWAYS AS ('golf'::text) STORED,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  leaderboard_version INTEGER NOT NULL DEFAULT 1 CHECK (leaderboard_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, event_id),
  FOREIGN KEY (root_event_id, event_id, capability_type)
    REFERENCES event_capabilities(root_event_id, event_id, capability_type)
);

CREATE TABLE event_golf_round_holes (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  hole SMALLINT NOT NULL CHECK (hole BETWEEN 1 AND 18),
  par SMALLINT NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index SMALLINT NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  PRIMARY KEY (root_event_id, event_id, hole),
  UNIQUE (root_event_id, event_id, stroke_index),
  FOREIGN KEY (root_event_id, event_id)
    REFERENCES event_golf_rounds(root_event_id, event_id) ON DELETE CASCADE
);

CREATE TABLE event_golf_round_players (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, event_id, user_id),
  FOREIGN KEY (root_event_id, event_id)
    REFERENCES event_golf_rounds(root_event_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (root_event_id, user_id)
    REFERENCES event_memberships(root_event_id, user_id)
);

CREATE TABLE event_golf_round_teams (
  id TEXT PRIMARY KEY CHECK (id ~ '^gtm_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  color TEXT CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_position SMALLINT NOT NULL CHECK (sort_position BETWEEN 0 AND 49),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, event_id, id),
  UNIQUE (root_event_id, event_id, sort_position),
  FOREIGN KEY (root_event_id, event_id)
    REFERENCES event_golf_rounds(root_event_id, event_id) ON DELETE CASCADE
);

CREATE TABLE event_golf_round_team_members (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (root_event_id, event_id, team_id, user_id),
  UNIQUE (root_event_id, event_id, user_id),
  FOREIGN KEY (root_event_id, event_id, team_id)
    REFERENCES event_golf_round_teams(root_event_id, event_id, id) ON DELETE CASCADE,
  FOREIGN KEY (root_event_id, event_id, user_id)
    REFERENCES event_golf_round_players(root_event_id, event_id, user_id) ON DELETE CASCADE
);

CREATE TABLE event_golf_scores (
  id TEXT PRIMARY KEY CHECK (id ~ '^gsc_[A-Za-z0-9._:-]{1,156}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  hole SMALLINT NOT NULL,
  strokes SMALLINT CHECK (strokes IS NULL OR strokes BETWEEN 1 AND 99),
  putts SMALLINT CHECK (putts IS NULL OR putts BETWEEN 0 AND 99),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  handicap_strokes SMALLINT NOT NULL CHECK (handicap_strokes BETWEEN -99 AND 99),
  net_strokes SMALLINT,
  stableford_points SMALLINT NOT NULL CHECK (stableford_points BETWEEN 0 AND 6),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, event_id, user_id, hole),
  FOREIGN KEY (root_event_id, event_id, hole)
    REFERENCES event_golf_round_holes(root_event_id, event_id, hole),
  FOREIGN KEY (root_event_id, event_id, user_id)
    REFERENCES event_golf_round_players(root_event_id, event_id, user_id),
  CHECK (
    (strokes IS NULL AND putts IS NULL AND net_strokes IS NULL AND stableford_points = 0) OR
    (strokes IS NOT NULL AND net_strokes = strokes - handicap_strokes)
  )
);

CREATE INDEX event_golf_scores_leaderboard_idx
  ON event_golf_scores(root_event_id, event_id, user_id, stableford_points);

CREATE FUNCTION enforce_event_golf_round_capability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
  FROM events event
  JOIN event_capabilities capability
    ON capability.root_event_id = event.root_event_id
    AND capability.event_id = event.id
    AND capability.capability_type = 'golf'
  WHERE event.root_event_id = NEW.root_event_id
    AND event.id = NEW.event_id
    AND event.kind = 'golf'
    AND event.deleted_at IS NULL
    AND capability.deleted_at IS NULL
  FOR SHARE OF event, capability;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'golf round requires a live golf event capability'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_golf_round_capability_guard
  BEFORE INSERT OR UPDATE OF root_event_id, event_id ON event_golf_rounds
  FOR EACH ROW EXECUTE FUNCTION enforce_event_golf_round_capability();

CREATE FUNCTION enforce_event_golf_scorecard_shape()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_root_event_id TEXT := COALESCE(NEW.root_event_id, OLD.root_event_id);
  target_event_id TEXT := COALESCE(NEW.event_id, OLD.event_id);
  hole_count INTEGER;
  stroke_index_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM event_golf_rounds
    WHERE root_event_id = target_root_event_id AND event_id = target_event_id
  ) THEN
    RETURN NULL;
  END IF;
  SELECT count(*)::int, count(DISTINCT stroke_index)::int
  INTO hole_count, stroke_index_count
  FROM event_golf_round_holes
  WHERE root_event_id = target_root_event_id AND event_id = target_event_id;
  IF hole_count <> 18 OR stroke_index_count <> 18 THEN
    RAISE EXCEPTION 'golf scorecard must contain holes and stroke indices 1 through 18'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER event_golf_round_scorecard_guard
  AFTER INSERT OR UPDATE ON event_golf_rounds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_event_golf_scorecard_shape();

CREATE CONSTRAINT TRIGGER event_golf_holes_scorecard_guard
  AFTER INSERT OR UPDATE OR DELETE ON event_golf_round_holes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_event_golf_scorecard_shape();

CREATE FUNCTION enforce_event_golf_team_capacity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_root_event_id TEXT := COALESCE(NEW.root_event_id, OLD.root_event_id);
  target_event_id TEXT := COALESCE(NEW.event_id, OLD.event_id);
  target_team_id TEXT := COALESCE(NEW.team_id, OLD.team_id);
BEGIN
  IF (
    SELECT count(*) FROM event_golf_round_team_members
    WHERE root_event_id = target_root_event_id
      AND event_id = target_event_id AND team_id = target_team_id
  ) > 4 THEN
    RAISE EXCEPTION 'golf team cannot contain more than four players'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER event_golf_team_capacity_guard
  AFTER INSERT OR UPDATE ON event_golf_round_team_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_event_golf_team_capacity();

CREATE FUNCTION prevent_live_golf_capability_breakage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.capability_type <> 'golf' THEN
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_golf_rounds round
    WHERE round.root_event_id = OLD.root_event_id AND round.event_id = OLD.event_id
  ) THEN
    RAISE EXCEPTION 'golf capability has live round data' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM event_golf_scores score
    WHERE score.root_event_id = OLD.root_event_id AND score.event_id = OLD.event_id
  ) AND (OLD.config - 'roundState') IS DISTINCT FROM (NEW.config - 'roundState') THEN
    RAISE EXCEPTION 'golf scoring configuration is immutable after scoring starts'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_golf_capability_dependency_guard
  BEFORE UPDATE OF config, deleted_at ON event_capabilities
  FOR EACH ROW EXECUTE FUNCTION prevent_live_golf_capability_breakage();
