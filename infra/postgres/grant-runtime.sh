#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_ADMIN_PASSWORD:?POSTGRES_ADMIN_PASSWORD is required}"

export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}"
exec psql \
	--host postgres \
	--port 5432 \
	--username crew_local_admin \
	--dbname postgres \
	--file /infra/postgres/grant-runtime.sql

