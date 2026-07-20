CREATE TABLE event_team_assignment_sets (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  capability_type TEXT GENERATED ALWAYS AS ('team'::text) STORED,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, event_id),
  FOREIGN KEY (root_event_id, event_id, capability_type)
    REFERENCES event_capabilities(root_event_id, event_id, capability_type)
);

CREATE TABLE event_team_teams (
  id TEXT PRIMARY KEY CHECK (id ~ '^ttm_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  color TEXT CHECK (color IS NULL OR color ~ '^#[0-9A-F]{6}$'),
  sort_position SMALLINT NOT NULL CHECK (sort_position BETWEEN 0 AND 99),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, event_id, id),
  UNIQUE (root_event_id, event_id, sort_position),
  FOREIGN KEY (root_event_id, event_id)
    REFERENCES event_team_assignment_sets(root_event_id, event_id) ON DELETE CASCADE
);

CREATE TABLE event_team_members (
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, event_id, user_id),
  UNIQUE (root_event_id, event_id, team_id, user_id),
  FOREIGN KEY (root_event_id, event_id, team_id)
    REFERENCES event_team_teams(root_event_id, event_id, id) ON DELETE CASCADE,
  FOREIGN KEY (root_event_id, user_id)
    REFERENCES event_memberships(root_event_id, user_id)
);

CREATE TABLE event_team_decisions (
  id TEXT PRIMARY KEY CHECK (id ~ '^tdc_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  capability_type TEXT GENERATED ALWAYS AS ('team'::text) STORED,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  state TEXT NOT NULL CHECK (state IN ('draft', 'open', 'closed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  aggregate_version INTEGER NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  created_by TEXT NOT NULL CHECK (created_by ~ '^usr_[a-f0-9]{32}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, event_id, id),
  FOREIGN KEY (root_event_id, event_id, capability_type)
    REFERENCES event_capabilities(root_event_id, event_id, capability_type),
  FOREIGN KEY (root_event_id, created_by)
    REFERENCES event_memberships(root_event_id, user_id)
);

CREATE TABLE event_team_decision_options (
  id TEXT PRIMARY KEY CHECK (id ~ '^tdo_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 160),
  sort_position SMALLINT NOT NULL CHECK (sort_position BETWEEN 0 AND 19),
  UNIQUE (root_event_id, event_id, decision_id, id),
  UNIQUE (root_event_id, event_id, decision_id, sort_position),
  FOREIGN KEY (root_event_id, event_id, decision_id)
    REFERENCES event_team_decisions(root_event_id, event_id, id) ON DELETE CASCADE
);

CREATE TABLE event_team_decision_responses (
  id TEXT PRIMARY KEY CHECK (id ~ '^trp_tdc_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  option_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, event_id, decision_id, user_id),
  FOREIGN KEY (root_event_id, event_id, decision_id)
    REFERENCES event_team_decisions(root_event_id, event_id, id) ON DELETE CASCADE,
  FOREIGN KEY (root_event_id, event_id, decision_id, option_id)
    REFERENCES event_team_decision_options(root_event_id, event_id, decision_id, id),
  FOREIGN KEY (root_event_id, user_id)
    REFERENCES event_memberships(root_event_id, user_id),
  CHECK (id = 'trp_' || decision_id || ':' || user_id)
);

CREATE FUNCTION enforce_event_team_member_assignment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  configured_capacity INTEGER;
BEGIN
  SELECT NULLIF(capability.config->>'capacityPerTeam', '')::int
  INTO configured_capacity
  FROM event_capabilities capability
  WHERE capability.root_event_id = NEW.root_event_id
    AND capability.event_id = NEW.event_id
    AND capability.capability_type = 'team'
    AND capability.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team assignment requires a live team capability'
      USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM event_memberships membership
  WHERE membership.root_event_id = NEW.root_event_id
    AND membership.user_id = NEW.user_id
    AND membership.status = 'active' AND membership.role <> 'viewer'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team assignment requires an active non-viewer member'
      USING ERRCODE = '23514';
  END IF;
  IF configured_capacity IS NOT NULL AND (
    SELECT count(*) FROM event_team_members member
    WHERE member.root_event_id = NEW.root_event_id
      AND member.event_id = NEW.event_id AND member.team_id = NEW.team_id
  ) > configured_capacity THEN
    RAISE EXCEPTION 'team assignment exceeds configured capacity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER event_team_member_assignment_guard
  AFTER INSERT OR UPDATE ON event_team_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_event_team_member_assignment();

CREATE FUNCTION enforce_event_team_response()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM event_team_decisions decision
  WHERE decision.root_event_id = NEW.root_event_id
    AND decision.event_id = NEW.event_id AND decision.id = NEW.decision_id
    AND decision.state = 'open'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team decision is not open' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM event_memberships membership
  WHERE membership.root_event_id = NEW.root_event_id
    AND membership.user_id = NEW.user_id
    AND membership.status = 'active' AND membership.role <> 'viewer'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team response requires an active non-viewer member'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_team_response_guard
  BEFORE INSERT OR UPDATE OF root_event_id, event_id, decision_id, user_id, option_id
  ON event_team_decision_responses
  FOR EACH ROW EXECUTE FUNCTION enforce_event_team_response();

CREATE FUNCTION prevent_live_team_capability_breakage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  new_capacity INTEGER;
BEGIN
  IF OLD.capability_type <> 'team' THEN
    RETURN NEW;
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM event_team_assignment_sets assignment_set
      WHERE assignment_set.root_event_id = OLD.root_event_id
        AND assignment_set.event_id = OLD.event_id
    ) OR EXISTS (
      SELECT 1 FROM event_team_decisions decision
      WHERE decision.root_event_id = OLD.root_event_id
        AND decision.event_id = OLD.event_id
    )
  ) THEN
    RAISE EXCEPTION 'team capability has live collaboration data'
      USING ERRCODE = '23514';
  END IF;
  new_capacity := NULLIF(NEW.config->>'capacityPerTeam', '')::int;
  IF new_capacity IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_team_members member
    WHERE member.root_event_id = NEW.root_event_id
      AND member.event_id = NEW.event_id
    GROUP BY member.team_id HAVING count(*) > new_capacity
  ) THEN
    RAISE EXCEPTION 'team capability capacity is below a published team size'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_team_capability_dependency_guard
  BEFORE UPDATE OF config, deleted_at ON event_capabilities
  FOR EACH ROW EXECUTE FUNCTION prevent_live_team_capability_breakage();
