#!/usr/bin/env bash
set -Eeuo pipefail

required_variables=(
	USER_DB_OWNER_PASSWORD
	USER_DB_API_PASSWORD
	USER_DB_MAGIC_WORKER_PASSWORD
	USER_DB_PUSH_WORKER_PASSWORD
	EVENT_DB_OWNER_PASSWORD
	EVENT_DB_API_PASSWORD
	EVENT_DB_ATTACHMENT_WORKER_PASSWORD
	EVENT_DB_NOTIFICATION_WORKER_PASSWORD
	EVENT_DB_RECAP_RETENTION_WORKER_PASSWORD
)
for variable_name in "${required_variables[@]}"; do
	if [[ -z "${!variable_name:-}" ]]; then
		echo "Missing required database credential: ${variable_name}" >&2
		exit 1
	fi
done

psql \
	--set ON_ERROR_STOP=1 \
	--username "${POSTGRES_USER}" \
	--dbname "${POSTGRES_DB}" \
	--set user_owner_password="${USER_DB_OWNER_PASSWORD}" \
	--set user_api_password="${USER_DB_API_PASSWORD}" \
	--set user_magic_password="${USER_DB_MAGIC_WORKER_PASSWORD}" \
	--set user_push_password="${USER_DB_PUSH_WORKER_PASSWORD}" \
	--set event_owner_password="${EVENT_DB_OWNER_PASSWORD}" \
	--set event_api_password="${EVENT_DB_API_PASSWORD}" \
	--set event_attachment_password="${EVENT_DB_ATTACHMENT_WORKER_PASSWORD}" \
	--set event_notification_password="${EVENT_DB_NOTIFICATION_WORKER_PASSWORD}" \
	--set event_recap_retention_password="${EVENT_DB_RECAP_RETENTION_WORKER_PASSWORD}" <<'SQL'
CREATE ROLE crew_user_owner LOGIN PASSWORD :'user_owner_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_user_api LOGIN PASSWORD :'user_api_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_user_magic_worker LOGIN PASSWORD :'user_magic_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_user_push_worker LOGIN PASSWORD :'user_push_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE ROLE crew_event_owner LOGIN PASSWORD :'event_owner_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_event_api LOGIN PASSWORD :'event_api_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_event_attachment_worker LOGIN PASSWORD :'event_attachment_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_event_notification_worker LOGIN PASSWORD :'event_notification_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crew_event_recap_retention_worker LOGIN PASSWORD :'event_recap_retention_password'
	NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE DATABASE crew_user OWNER crew_user_owner;
CREATE DATABASE crew_event OWNER crew_event_owner;

REVOKE ALL ON DATABASE crew_user FROM PUBLIC;
REVOKE ALL ON DATABASE crew_event FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE crew_user TO
	crew_user_owner, crew_user_api, crew_user_magic_worker, crew_user_push_worker;
GRANT CONNECT, TEMPORARY ON DATABASE crew_event TO
	crew_event_owner, crew_event_api, crew_event_attachment_worker,
	crew_event_notification_worker, crew_event_recap_retention_worker;

\connect crew_user
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO crew_user_owner;
GRANT USAGE ON SCHEMA public TO
	crew_user_api, crew_user_magic_worker, crew_user_push_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE crew_user_owner IN SCHEMA public
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

\connect crew_event
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO crew_event_owner;
GRANT USAGE ON SCHEMA public TO
	crew_event_api, crew_event_attachment_worker, crew_event_notification_worker,
	crew_event_recap_retention_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE crew_event_owner IN SCHEMA public
	REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
SQL
