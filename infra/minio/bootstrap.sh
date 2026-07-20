#!/bin/sh
set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_API_ACCESS_KEY:?MINIO_API_ACCESS_KEY is required}"
: "${MINIO_API_SECRET_KEY:?MINIO_API_SECRET_KEY is required}"
: "${MINIO_WORKER_ACCESS_KEY:?MINIO_WORKER_ACCESS_KEY is required}"
: "${MINIO_WORKER_SECRET_KEY:?MINIO_WORKER_SECRET_KEY is required}"
: "${MINIO_BUCKET_QUOTA:?MINIO_BUCKET_QUOTA is required}"

endpoint=${MINIO_ENDPOINT:-http://minio:9000}
config_dir=${MINIO_CONFIG_DIR:-/infra/minio}
bucket=crew-event-development

mc alias set local "${endpoint}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"
mc ready local
mc mb --ignore-existing --region us-east-1 "local/${bucket}"
mc anonymous set none "local/${bucket}"
mc ilm rule import "local/${bucket}" < "${config_dir}/lifecycle.json"
mc quota set "local/${bucket}" --size "${MINIO_BUCKET_QUOTA}"
mc admin policy create local crew-event-api "${config_dir}/api-policy.json"
mc admin policy create local crew-event-attachment-worker \
	"${config_dir}/worker-policy.json"
mc admin user add local "${MINIO_API_ACCESS_KEY}" "${MINIO_API_SECRET_KEY}"
mc admin user add local "${MINIO_WORKER_ACCESS_KEY}" "${MINIO_WORKER_SECRET_KEY}"
mc admin policy attach local crew-event-api --user "${MINIO_API_ACCESS_KEY}"
mc admin policy attach local crew-event-attachment-worker \
	--user "${MINIO_WORKER_ACCESS_KEY}"
mc admin prometheus generate local api --bucket "${bucket}" \
	--api-version v3 >/dev/null
mc ilm rule ls --json "local/${bucket}" >/dev/null
mc quota info --json "local/${bucket}" >/dev/null
mc stat "local/${bucket}" >/dev/null
