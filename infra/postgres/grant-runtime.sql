\set ON_ERROR_STOP on

\connect crew_user
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
	crew_user_api, crew_user_magic_worker, crew_user_push_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM
	crew_user_api, crew_user_magic_worker, crew_user_push_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

SELECT format(
	'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO crew_user_api',
	schemaname,
	tablename
)
FROM pg_tables
WHERE schemaname = 'public' AND tablename <> 'user_schema_migrations'
\gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crew_user_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO crew_user_api;

GRANT SELECT, UPDATE, DELETE ON TABLE user_delivery_outbox
TO crew_user_magic_worker;
GRANT SELECT, UPDATE, DELETE ON TABLE user_push_outbox
TO crew_user_push_worker;
GRANT SELECT ON TABLE user_profiles, user_devices TO crew_user_push_worker;

\connect crew_event
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM
	crew_event_api, crew_event_attachment_worker, crew_event_notification_worker,
	crew_event_recap_retention_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM
	crew_event_api, crew_event_attachment_worker, crew_event_notification_worker,
	crew_event_recap_retention_worker;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

SELECT format(
	'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO crew_event_api',
	schemaname,
	tablename
)
FROM pg_tables
WHERE schemaname = 'public'
	AND tablename NOT IN ('event_schema_migrations', 'event_attachments')
\gexec
GRANT SELECT, INSERT ON TABLE event_attachments TO crew_event_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crew_event_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO crew_event_api;
REVOKE EXECUTE ON FUNCTION delete_claimed_feedback_attachment(
	TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM
	PUBLIC, crew_event_api, crew_event_notification_worker,
	crew_event_recap_retention_worker;
REVOKE ALL ON TABLE event_recap_external_retention_state FROM crew_event_api;
REVOKE EXECUTE ON FUNCTION event_recap_external_link_metadata_complete(TEXT)
FROM crew_event_api;
REVOKE EXECUTE ON FUNCTION purge_event_recap_external_metadata(INTEGER)
FROM crew_event_api;
GRANT EXECUTE ON FUNCTION purge_event_recap_external_metadata(INTEGER)
TO crew_event_recap_retention_worker;

GRANT SELECT, UPDATE ON TABLE
	event_attachment_verify_jobs,
	event_attachment_cleanup_jobs,
	event_attachment_uploads
TO crew_event_attachment_worker;
GRANT SELECT ON TABLE event_attachments
TO crew_event_attachment_worker;
GRANT SELECT ON TABLE event_feedback_attachments
TO crew_event_attachment_worker;
GRANT EXECUTE ON FUNCTION delete_claimed_feedback_attachment(
	TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) TO crew_event_attachment_worker;

GRANT SELECT, UPDATE, DELETE ON TABLE event_notification_outbox
TO crew_event_notification_worker;
GRANT UPDATE (root_event_id) ON TABLE event_roots
TO crew_event_notification_worker;
GRANT SELECT ON TABLE
	event_roots,
	events,
	event_memberships,
	event_feed_entries,
	event_feed_entry_current
TO crew_event_notification_worker;
GRANT EXECUTE ON FUNCTION event_feed_context_recipient_can_read(TEXT, TEXT, TEXT)
TO crew_event_notification_worker;
GRANT EXECUTE ON FUNCTION event_feed_recipient_can_read(TEXT, TEXT, TEXT)
TO crew_event_notification_worker;
