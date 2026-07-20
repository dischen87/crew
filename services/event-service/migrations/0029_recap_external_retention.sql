CREATE INDEX event_recap_external_share_audit_events_link
  ON event_recap_external_share_audit_events (link_id, id);

CREATE INDEX event_recap_share_links_external_retention
  ON event_recap_share_links (
    (LEAST(expires_at, COALESCE(revoked_at, expires_at))),
    id
  )
  WHERE projection_consent = 'exact-fields-reviewed-v1';

CREATE INDEX event_recap_external_grant_decisions_retention_scan
  ON event_recap_external_grant_decisions (decided_at, id);

CREATE INDEX event_recap_external_grant_decisions_exact_chain
  ON event_recap_external_grant_decisions (
    root_event_id, recap_version, recap_ordinal, source_type, source_id,
    source_version, field_name, authority, id
  );

CREATE INDEX event_recap_external_share_fields_exact_chain
  ON event_recap_external_share_fields (
    root_event_id, recap_version, recap_ordinal, source_type, source_id,
    source_version, field_name
  );

CREATE TABLE event_recap_external_retention_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  link_cursor_terminal_at TIMESTAMPTZ,
  link_cursor_id TEXT,
  decision_cursor_decided_at TIMESTAMPTZ,
  decision_cursor_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (link_cursor_terminal_at IS NULL) = (link_cursor_id IS NULL)
  ),
  CHECK (
    (decision_cursor_decided_at IS NULL) = (decision_cursor_id IS NULL)
  )
);

INSERT INTO event_recap_external_retention_state (singleton) VALUES (TRUE);

CREATE FUNCTION guard_event_recap_external_retention_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('crew.recap_external_retention_delete', true) = 'enabled'
    AND current_user = pg_get_userbyid(
      (SELECT relowner FROM pg_class WHERE oid = TG_RELID)
    )
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'event recap external metadata is immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER event_recap_external_grant_decisions_immutable
  ON event_recap_external_grant_decisions;
CREATE TRIGGER event_recap_external_grant_decisions_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_grant_decisions
  FOR EACH ROW EXECUTE FUNCTION guard_event_recap_external_retention_delete();

DROP TRIGGER event_recap_external_share_fields_immutable
  ON event_recap_external_share_fields;
CREATE TRIGGER event_recap_external_share_fields_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_share_fields
  FOR EACH ROW EXECUTE FUNCTION guard_event_recap_external_retention_delete();

DROP TRIGGER event_recap_external_share_audit_events_immutable
  ON event_recap_external_share_audit_events;
CREATE TRIGGER event_recap_external_share_audit_events_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_share_audit_events
  FOR EACH ROW EXECUTE FUNCTION guard_event_recap_external_retention_delete();

CREATE TRIGGER event_recap_external_share_links_retention_delete
  BEFORE DELETE ON event_recap_share_links
  FOR EACH ROW EXECUTE FUNCTION guard_event_recap_external_retention_delete();

CREATE FUNCTION event_recap_external_link_metadata_complete(p_link_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT
      EXISTS (
        SELECT 1
        FROM public.event_recap_external_share_fields AS field
        WHERE field.link_id = link.id
          AND field.root_event_id = link.root_event_id
          AND field.recap_version = link.recap_version
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_recap_external_share_fields AS field
        WHERE field.link_id = link.id
          AND (
            NOT EXISTS (
              SELECT 1
              FROM public.event_recap_external_grant_decisions AS decision
              WHERE decision.root_event_id = field.root_event_id
                AND decision.recap_version = field.recap_version
                AND decision.recap_ordinal = field.recap_ordinal
                AND decision.source_type = field.source_type
                AND decision.source_id = field.source_id
                AND decision.source_version = field.source_version
                AND decision.field_name = field.field_name
                AND decision.authority = 'manager'
            )
            OR (
              field.source_type = 'feedEntry'
              AND NOT EXISTS (
                SELECT 1
                FROM public.event_recap_external_grant_decisions AS decision
                WHERE decision.root_event_id = field.root_event_id
                  AND decision.recap_version = field.recap_version
                  AND decision.recap_ordinal = field.recap_ordinal
                  AND decision.source_type = field.source_type
                  AND decision.source_id = field.source_id
                  AND decision.source_version = field.source_version
                  AND decision.field_name = field.field_name
                  AND decision.authority = 'author'
              )
            )
          )
      )
      AND audit_chain.create_count = 1
      AND audit_chain.matching_create_count = 1
      AND (
        (
          link.revoked_at IS NULL
          AND audit_chain.total_count = 1
          AND audit_chain.terminal_count = 0
        )
        OR (
          link.revoked_at IS NOT NULL
          AND audit_chain.total_count = 2
          AND audit_chain.terminal_count = 1
          AND audit_chain.matching_terminal_count = 1
        )
      )
    FROM public.event_recap_share_links AS link
    CROSS JOIN LATERAL (
      SELECT
        count(*)::INTEGER AS total_count,
        count(*) FILTER (WHERE audit.action = 'create')::INTEGER AS create_count,
        count(*) FILTER (
          WHERE audit.action = 'create'
            AND audit.occurred_at = link.created_at
        )::INTEGER AS matching_create_count,
        count(*) FILTER (
          WHERE audit.action IN ('rotate', 'revoke')
        )::INTEGER AS terminal_count,
        count(*) FILTER (
          WHERE audit.action IN ('rotate', 'revoke')
            AND audit.occurred_at >= link.revoked_at
        )::INTEGER AS matching_terminal_count
      FROM (
        SELECT bounded.action, bounded.occurred_at
        FROM public.event_recap_external_share_audit_events AS bounded
        WHERE bounded.link_id = link.id
          AND bounded.root_event_id = link.root_event_id
        ORDER BY bounded.id
        LIMIT 3
      ) AS audit
    ) AS audit_chain
    WHERE link.id = p_link_id
      AND link.projection_consent = 'exact-fields-reviewed-v1'
  ), FALSE);
$$;

REVOKE ALL ON FUNCTION event_recap_external_link_metadata_complete(TEXT)
  FROM PUBLIC;

CREATE FUNCTION purge_event_recap_external_metadata(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  lease_acquired INTEGER,
  scanned_links INTEGER,
  scanned_grant_decisions INTEGER,
  purged_links INTEGER,
  purged_fields INTEGER,
  purged_audit_events INTEGER,
  purged_grant_decisions INTEGER,
  ambiguous_links INTEGER,
  scan_saturated INTEGER,
  oldest_scanned_age_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_cutoff TIMESTAMPTZ := v_now - interval '90 days';
  v_link_cursor_at TIMESTAMPTZ;
  v_link_cursor_id TEXT;
  v_decision_cursor_at TIMESTAMPTZ;
  v_decision_cursor_id BIGINT;
  v_scanned_link_ids TEXT[] := ARRAY[]::TEXT[];
  v_purge_link_ids TEXT[] := ARRAY[]::TEXT[];
  v_scanned_decision_ids BIGINT[] := ARRAY[]::BIGINT[];
  v_oldest_link TIMESTAMPTZ;
  v_oldest_decision TIMESTAMPTZ;
  v_oldest TIMESTAMPTZ;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'recap external retention limit must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  lease_acquired := 0;
  scanned_links := 0;
  scanned_grant_decisions := 0;
  purged_links := 0;
  purged_fields := 0;
  purged_audit_events := 0;
  purged_grant_decisions := 0;
  ambiguous_links := 0;
  scan_saturated := 0;
  oldest_scanned_age_seconds := 0;

  SELECT
    state.link_cursor_terminal_at,
    state.link_cursor_id,
    state.decision_cursor_decided_at,
    state.decision_cursor_id
  INTO
    v_link_cursor_at,
    v_link_cursor_id,
    v_decision_cursor_at,
    v_decision_cursor_id
  FROM public.event_recap_external_retention_state AS state
  WHERE state.singleton
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;
  lease_acquired := 1;
  PERFORM set_config(
    'crew.recap_external_retention_delete',
    'enabled',
    true
  );

  SELECT
    COALESCE(array_agg(candidate.id ORDER BY candidate.terminal_at, candidate.id), ARRAY[]::TEXT[]),
    count(*)::INTEGER,
    min(candidate.terminal_at)
  INTO v_scanned_link_ids, scanned_links, v_oldest_link
  FROM (
    SELECT
      link.id,
      LEAST(link.expires_at, COALESCE(link.revoked_at, link.expires_at))
        AS terminal_at
    FROM public.event_recap_share_links AS link
    JOIN public.event_roots AS root
      ON root.root_event_id = link.root_event_id
    WHERE link.projection_consent = 'exact-fields-reviewed-v1'
      AND LEAST(link.expires_at, COALESCE(link.revoked_at, link.expires_at))
        <= v_cutoff
      AND (
        v_link_cursor_at IS NULL
        OR (
          LEAST(link.expires_at, COALESCE(link.revoked_at, link.expires_at)),
          link.id
        ) > (v_link_cursor_at, v_link_cursor_id)
      )
    ORDER BY
      LEAST(link.expires_at, COALESCE(link.revoked_at, link.expires_at)),
      link.id
    FOR UPDATE OF root, link SKIP LOCKED
    LIMIT p_limit
  ) AS candidate;

  IF scanned_links = 0 THEN
    v_link_cursor_at := NULL;
    v_link_cursor_id := NULL;
  ELSE
    v_link_cursor_id := v_scanned_link_ids[scanned_links];
    SELECT LEAST(link.expires_at, COALESCE(link.revoked_at, link.expires_at))
    INTO v_link_cursor_at
    FROM public.event_recap_share_links AS link
    WHERE link.id = v_link_cursor_id;

    SELECT COALESCE(array_agg(scanned.id), ARRAY[]::TEXT[])
    INTO v_purge_link_ids
    FROM unnest(v_scanned_link_ids) AS scanned(id)
    WHERE public.event_recap_external_link_metadata_complete(scanned.id);
    ambiguous_links := scanned_links - cardinality(v_purge_link_ids);

    DELETE FROM public.event_recap_external_share_fields AS field
    WHERE field.link_id = ANY(v_purge_link_ids);
    GET DIAGNOSTICS purged_fields = ROW_COUNT;

    DELETE FROM public.event_recap_external_share_audit_events AS audit
    WHERE audit.link_id = ANY(v_purge_link_ids);
    GET DIAGNOSTICS purged_audit_events = ROW_COUNT;

    DELETE FROM public.event_recap_share_links AS link
    WHERE link.id = ANY(v_purge_link_ids)
      AND link.projection_consent = 'exact-fields-reviewed-v1';
    GET DIAGNOSTICS purged_links = ROW_COUNT;
  END IF;

  SELECT
    COALESCE(array_agg(candidate.id ORDER BY candidate.decided_at, candidate.id), ARRAY[]::BIGINT[]),
    count(*)::INTEGER,
    min(candidate.decided_at)
  INTO
    v_scanned_decision_ids,
    scanned_grant_decisions,
    v_oldest_decision
  FROM (
    SELECT decision.id, decision.decided_at
    FROM public.event_recap_external_grant_decisions AS decision
    JOIN public.event_roots AS root
      ON root.root_event_id = decision.root_event_id
    WHERE decision.decided_at <= v_cutoff
      AND (
        v_decision_cursor_at IS NULL
        OR (decision.decided_at, decision.id)
          > (v_decision_cursor_at, v_decision_cursor_id)
      )
    ORDER BY decision.decided_at, decision.id
    FOR UPDATE OF root, decision SKIP LOCKED
    LIMIT p_limit
  ) AS candidate;

  IF scanned_grant_decisions = 0 THEN
    v_decision_cursor_at := NULL;
    v_decision_cursor_id := NULL;
  ELSE
    v_decision_cursor_id := v_scanned_decision_ids[scanned_grant_decisions];
    SELECT decision.decided_at
    INTO v_decision_cursor_at
    FROM public.event_recap_external_grant_decisions AS decision
    WHERE decision.id = v_decision_cursor_id;

    DELETE FROM public.event_recap_external_grant_decisions AS decision
    WHERE decision.id = ANY(v_scanned_decision_ids)
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_recap_external_share_fields AS field
        WHERE field.root_event_id = decision.root_event_id
          AND field.recap_version = decision.recap_version
          AND field.recap_ordinal = decision.recap_ordinal
          AND field.source_type = decision.source_type
          AND field.source_id = decision.source_id
          AND field.source_version = decision.source_version
          AND field.field_name = decision.field_name
      )
      AND (
        SELECT latest.decided_at
        FROM public.event_recap_external_grant_decisions AS latest
        WHERE latest.root_event_id = decision.root_event_id
          AND latest.recap_version = decision.recap_version
          AND latest.recap_ordinal = decision.recap_ordinal
          AND latest.source_type = decision.source_type
          AND latest.source_id = decision.source_id
          AND latest.source_version = decision.source_version
          AND latest.field_name = decision.field_name
          AND latest.authority = decision.authority
        ORDER BY latest.id DESC
        LIMIT 1
      ) <= v_cutoff
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_recap_external_grant_decisions AS older
        WHERE older.root_event_id = decision.root_event_id
          AND older.recap_version = decision.recap_version
          AND older.recap_ordinal = decision.recap_ordinal
          AND older.source_type = decision.source_type
          AND older.source_id = decision.source_id
          AND older.source_version = decision.source_version
          AND older.field_name = decision.field_name
          AND older.authority = decision.authority
          AND older.id < decision.id
          AND NOT (older.id = ANY(v_scanned_decision_ids))
      );
    GET DIAGNOSTICS purged_grant_decisions = ROW_COUNT;
  END IF;

  scan_saturated := CASE
    WHEN scanned_links = p_limit OR scanned_grant_decisions = p_limit THEN 1
    ELSE 0
  END;
  v_oldest := CASE
    WHEN v_oldest_link IS NULL THEN v_oldest_decision
    WHEN v_oldest_decision IS NULL THEN v_oldest_link
    ELSE LEAST(v_oldest_link, v_oldest_decision)
  END;
  oldest_scanned_age_seconds := COALESCE(
    GREATEST(
      0,
      floor(EXTRACT(EPOCH FROM (v_now - v_oldest)))::INTEGER
    ),
    0
  );

  UPDATE public.event_recap_external_retention_state
  SET link_cursor_terminal_at = v_link_cursor_at,
      link_cursor_id = v_link_cursor_id,
      decision_cursor_decided_at = v_decision_cursor_at,
      decision_cursor_id = v_decision_cursor_id,
      updated_at = v_now
  WHERE singleton;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION purge_event_recap_external_metadata(INTEGER) FROM PUBLIC;
