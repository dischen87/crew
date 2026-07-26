#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit

action=${1:-}
target_sha=${2:-}
repository=${CREW_REPOSITORY_URL:-https://github.com/dischen87/crew.git}
deploy_root=${CREW_DEPLOY_ROOT:-/opt/crew-new}
legacy_digest_bridge_sha=b97b6bf355da0f1eb08aedc75263a9d8f2c48c6e
releases_dir="${deploy_root}/releases"
shared_dir="${deploy_root}/shared"
environment_file="${shared_dir}/environment"
records_dir="${shared_dir}/records"
compatibility_dir="${records_dir}/compatibility"
manifests_dir="${shared_dir}/manifests"
digest_override_file="${shared_dir}/compose.digest.yaml"
current_file="${shared_dir}/current-release"
previous_file="${shared_dir}/previous-release"
database_file="${shared_dir}/database-release"
grant_file="${shared_dir}/runtime-grant-sha256"
database_contract_file="${shared_dir}/database-contract-sha256"
runtime_contract_file="${shared_dir}/runtime-infrastructure-contract-sha256"
current_record_file="${shared_dir}/current-record"
lock_file="${shared_dir}/deploy.lock"

case "${action}" in
	deploy | rollback) ;;
	*)
		echo "Usage: host-release.sh deploy|rollback <40-character Git SHA>" >&2
		exit 2
		;;
esac

if [[ ! "${target_sha}" =~ ^[0-9a-f]{40}$ ]]; then
	echo "Target release must be a full lowercase Git SHA" >&2
	exit 2
fi
if [[ $(id -u) -ne 0 ]]; then
	echo "Crew staging deployment must run as root" >&2
	exit 2
fi

umask 077
mkdir -p \
	"${releases_dir}" "${shared_dir}/tls" "${records_dir}" \
	"${compatibility_dir}" "${manifests_dir}"
exec 9>"${lock_file}"
flock -n 9 || {
	echo "Another Crew staging deployment is running" >&2
	exit 1
}

base64url() {
	openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-'
}

hex_secret() {
	openssl rand -hex 32
}

environment_value() {
	local name=$1 count value
	count=$(grep -c "^${name}=" "${environment_file}" || true)
	if [[ "${count}" -ne 1 ]]; then
		echo "Crew staging environment must contain exactly one ${name}" >&2
		exit 1
	fi
	value=$(sed -n "s/^${name}=//p" "${environment_file}")
	if [[ -z "${value}" ]]; then
		echo "Crew staging environment ${name} must not be empty" >&2
		exit 1
	fi
	printf '%s\n' "${value}"
}

ensure_environment() {
	local typesense_admin_key typesense_search_key
	if [[ -f "${environment_file}" ]]; then
		if [[ $(stat -c '%a' "${environment_file}") != 600 ]]; then
			echo "Crew staging environment file must have mode 0600" >&2
			exit 1
		fi
		typesense_admin_key=$(environment_value TYPESENSE_API_KEY)
		typesense_search_key=$(environment_value TYPESENSE_SEARCH_API_KEY)
		if [[ "${typesense_admin_key}" == "${typesense_search_key}" ]]; then
			echo "Typesense admin and search-only keys must be different" >&2
			exit 1
		fi
		return
	fi

	local temporary
	temporary=$(mktemp "${shared_dir}/.environment.XXXXXX")
	typesense_admin_key=$(hex_secret)
	typesense_search_key=$(hex_secret)
	{
		printf 'POSTGRES_ADMIN_PASSWORD=%s\n' "$(hex_secret)"
		printf 'USER_DB_OWNER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'USER_DB_API_PASSWORD=%s\n' "$(hex_secret)"
		printf 'USER_DB_MAGIC_WORKER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'USER_DB_PUSH_WORKER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'EVENT_DB_OWNER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'EVENT_DB_API_PASSWORD=%s\n' "$(hex_secret)"
		printf 'EVENT_DB_ATTACHMENT_WORKER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'EVENT_DB_NOTIFICATION_WORKER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'EVENT_DB_RECAP_RETENTION_WORKER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'REDIS_GATEWAY_PASSWORD=%s\n' "$(hex_secret)"
		printf 'REDIS_USER_PASSWORD=%s\n' "$(hex_secret)"
		printf 'MINIO_ROOT_USER=crewstagingadmin\n'
		printf 'MINIO_ROOT_PASSWORD=%s\n' "$(hex_secret)"
		printf 'MINIO_API_ACCESS_KEY=crewstagingapi\n'
		printf 'MINIO_API_SECRET_KEY=%s\n' "$(hex_secret)"
		printf 'MINIO_WORKER_ACCESS_KEY=crewstagingworker\n'
		printf 'MINIO_WORKER_SECRET_KEY=%s\n' "$(hex_secret)"
		printf 'TYPESENSE_API_KEY=%s\n' "${typesense_admin_key}"
		printf 'TYPESENSE_SEARCH_API_KEY=%s\n' "${typesense_search_key}"
		printf 'PROVIDER_SINK_BEARER=%s\n' "$(hex_secret)"
		printf 'PROVIDER_SINK_FIXTURE_BEARER=%s\n' "$(hex_secret)"
		printf 'REFRESH_TOKEN_KEY=%s\n' "$(base64url)"
		printf 'USER_RATE_LIMIT_KEY=%s\n' "$(base64url)"
		printf 'GATEWAY_RATE_LIMIT_KEY=%s\n' "$(base64url)"
		printf 'IDEMPOTENCY_PAYLOAD_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'DELIVERY_PAYLOAD_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'PUSH_PAYLOAD_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'EVENT_NOTIFICATION_SERVICE_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'MEMBER_DIRECTORY_SERVICE_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'INVITATION_TOKEN_KEY=%s\n' "$(base64url)"
		printf 'RECAP_SHARE_TOKEN_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'RECAP_CAPTION_FIELD_REF_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'SYNC_CURSOR_KEY=%s\n' "$(base64url)"
		printf 'ATTACHMENT_GRANT_KEY=%s\n' "$(base64url)"
		printf 'EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'PLACE_CANDIDATE_SERVICE_CURRENT_KEY=%s\n' "$(base64url)"
		printf 'PLACE_SEARCH_CURSOR_KEY=%s\n' "$(base64url)"
	} >"${temporary}"
	chmod 0600 "${temporary}"
	mv "${temporary}" "${environment_file}"
}

checkout_release() {
	local release_dir="${releases_dir}/${target_sha}"
	if [[ -d "${release_dir}/.git" ]]; then
		if [[ $(git -C "${release_dir}" rev-parse HEAD) != "${target_sha}" ]] ||
			! git -C "${release_dir}" diff --quiet ||
			! git -C "${release_dir}" diff --cached --quiet ||
			[[ -n $(git -C "${release_dir}" status --short) ]]; then
			echo "Existing release checkout is not clean ${target_sha}" >&2
			exit 1
		fi
		printf '%s\n' "${release_dir}"
		return
	fi

	local temporary
	temporary=$(mktemp -d "${releases_dir}/.checkout.XXXXXX")
	git clone --filter=blob:none --no-checkout "${repository}" "${temporary}" >/dev/null
	git -C "${temporary}" fetch --quiet origin "${target_sha}"
	git -C "${temporary}" checkout --quiet --detach "${target_sha}"
	if [[ $(git -C "${temporary}" rev-parse HEAD) != "${target_sha}" ]] ||
		! git -C "${temporary}" diff --quiet ||
		! git -C "${temporary}" diff --cached --quiet ||
		[[ -n $(git -C "${temporary}" status --short) ]]; then
		echo "Release checkout is not the requested clean revision" >&2
		exit 1
	fi
	mv "${temporary}" "${release_dir}"
	printf '%s\n' "${release_dir}"
}

database_contract_sha() {
	local release_dir=$1
	(
		cd "${release_dir}"
		find \
			services/user-service/migrations \
			services/event-service/migrations \
			infra/postgres/grant-runtime.sql \
			-type f -print0 |
			sort -z |
			xargs -0 -r sha256sum
	) | sha256sum | cut -d ' ' -f 1
}

runtime_infrastructure_contract_sha() {
	local release_dir=$1
	(
		cd "${release_dir}"
		sha256sum \
			compose.yaml \
			infra/Dockerfile \
			infra/provider-sink.ts \
			infra/redis/Dockerfile \
			infra/redis/start.sh \
			infra/staging/compose.staging.yaml \
			infra/staging/haproxy.cfg
	) | sha256sum | cut -d ' ' -f 1
}

runtime_grant_sha() {
	sha256sum "$1/infra/postgres/grant-runtime.sql" | cut -d ' ' -f 1
}

canonicalize_image_manifest() {
	local source=$1 canonical=$2 environment_output=$3 expected_sha=$4
	python3 - "${source}" "${canonical}" "${environment_output}" \
		"${expected_sha}" <<'PY'
import json
import re
import sys

source, canonical_path, environment_path, expected_sha = sys.argv[1:]
def reject_duplicate_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"Duplicate image manifest key: {key}")
        value[key] = item
    return value

repositories = {
    "api-gateway": "ghcr.io/dischen87/crew-api-gateway",
    "user-service": "ghcr.io/dischen87/crew-user-service",
    "event-service": "ghcr.io/dischen87/crew-event-service",
    "infra": "ghcr.io/dischen87/crew-infra",
    "rate-limit-redis": "ghcr.io/dischen87/crew-rate-limit-redis",
    "web": "ghcr.io/dischen87/crew-web",
}
variables = {
    "api-gateway": "api_gateway_image",
    "user-service": "user_service_image",
    "event-service": "event_service_image",
    "infra": "infra_image",
    "rate-limit-redis": "rate_limit_redis_image",
    "web": "web_image",
}

with open(source, encoding="utf-8") as input_file:
    manifest = json.load(input_file, object_pairs_hook=reject_duplicate_keys)
if not isinstance(manifest, dict) or set(manifest) != {
    "schemaVersion", "releaseId", "platform", "images"
}:
    raise SystemExit("Image manifest fields are invalid")
if manifest["schemaVersion"] != 1:
    raise SystemExit("Image manifest schema is unsupported")
if manifest["releaseId"] != expected_sha:
    raise SystemExit("Image manifest release does not match the target")
if manifest["platform"] != "linux/amd64":
    raise SystemExit("Image manifest platform must be linux/amd64")
images = manifest["images"]
if not isinstance(images, dict) or set(images) != set(repositories):
    raise SystemExit("Image manifest must contain exactly six Crew images")
for name, repository in repositories.items():
    value = images[name]
    if not isinstance(value, str) or not re.fullmatch(
        re.escape(repository) + r"@sha256:[0-9a-f]{64}", value
    ):
        raise SystemExit(f"Image manifest reference is invalid for {name}")

with open(canonical_path, "w", encoding="utf-8") as output:
    json.dump(manifest, output, sort_keys=True, separators=(",", ":"))
    output.write("\n")
if environment_path != "-":
    with open(environment_path, "w", encoding="utf-8") as output:
        for name, variable in variables.items():
            output.write(f"{variable}={images[name]}\n")
PY
}

image_manifest_sha() {
	local release_sha=$1 manifest
	local canonical
	manifest="${manifests_dir}/${release_sha}.json"
	[[ -f "${manifest}" ]] || {
		echo "Image manifest is unavailable for ${release_sha}" >&2
		exit 1
	}
	canonical=$(mktemp "${manifests_dir}/.canonical.XXXXXX")
	canonicalize_image_manifest "${manifest}" "${canonical}" - "${release_sha}"
	sha256sum "${canonical}" | cut -d ' ' -f 1
	rm -f "${canonical}"
}

load_target_image_manifest() {
	local manifest="${manifests_dir}/${target_sha}.json"
	local source=${CREW_IMAGE_MANIFEST_SOURCE:-}
	local canonical environment_output existing_canonical
	canonical=$(mktemp "${manifests_dir}/.canonical.XXXXXX")
	environment_output=$(mktemp "${manifests_dir}/.environment.XXXXXX")
	if [[ -n "${source}" ]]; then
		[[ -f "${source}" ]] || {
			echo "Provided image manifest is unavailable" >&2
			exit 1
		}
		canonicalize_image_manifest \
			"${source}" "${canonical}" "${environment_output}" "${target_sha}"
		if [[ -f "${manifest}" ]]; then
			existing_canonical=$(mktemp "${manifests_dir}/.existing.XXXXXX")
			canonicalize_image_manifest \
				"${manifest}" "${existing_canonical}" - "${target_sha}"
			cmp --silent "${canonical}" "${existing_canonical}" || {
				echo "Stored image manifest differs for ${target_sha}" >&2
				exit 1
			}
			rm -f "${existing_canonical}"
		else
			install -o root -g root -m 0600 "${canonical}" "${manifest}"
		fi
	else
		[[ -f "${manifest}" ]] || {
			echo "Image manifest is unavailable for ${target_sha}" >&2
			exit 1
		}
		canonicalize_image_manifest \
			"${manifest}" "${canonical}" "${environment_output}" "${target_sha}"
	fi
	# Values are constrained above to fixed GHCR paths and lowercase digests.
	source "${environment_output}"
	target_manifest_sha=$(sha256sum "${canonical}" | cut -d ' ' -f 1)
	rm -f "${canonical}" "${environment_output}"
}

validate_record() {
	local record=$1 release_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
	local manifest manifest_sha
	[[ "${record}" == "${records_dir}/"* && -f "${record}" ]] ||
		{
			echo "Current release record is unavailable" >&2
			exit 1
		}
	grep -Fq "\"releaseId\": \"${release_sha}\"" "${record}"
	grep -Fq "\"databaseReleaseId\": \"${database_sha}\"" "${record}"
	grep -Fq "\"runtimeGrantSha256\": \"${grant_sha}\"" "${record}"
	grep -Fq \
		"\"databaseCompatibilitySha256\": \"${database_contract_sha}\"" "${record}"
	grep -Fq \
		"\"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"" \
		"${record}"
	if grep -Fq '"schemaVersion": 2' "${record}"; then
		manifest="${manifests_dir}/${release_sha}.json"
		manifest_sha=$(image_manifest_sha "${release_sha}")
		grep -Fq "\"imageManifestSha256\": \"${manifest_sha}\"" "${record}"
		python3 - "${record}" "${manifest}" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    record = json.load(input_file)
with open(sys.argv[2], encoding="utf-8") as input_file:
    manifest = json.load(input_file)
expected_images = dict(manifest["images"])
expected_images["internal-tls"] = (
    "haproxy:3.4.2-alpine@"
    "sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb"
)
if record.get("images") != expected_images:
    raise SystemExit("Release record image references differ from the manifest")
local_ids = record.get("localImageIds")
if not isinstance(local_ids, dict) or set(local_ids) != set(expected_images):
    raise SystemExit("Release record local image IDs are incomplete")
if any(
    not isinstance(value, str)
    or not re.fullmatch(r"sha256:[0-9a-f]{64}", value)
    for value in local_ids.values()
):
    raise SystemExit("Release record local image IDs are invalid")
PY
	else
		[[ "${release_sha}" == "${legacy_digest_bridge_sha}" ]] || {
			echo "Legacy release records are allowed only for the digest bridge" >&2
			exit 1
		}
		for image in provider-sink rate-limit-redis internal-tls; do
			grep -Eq "\"${image}\": \"sha256:[a-f0-9]{64}\"" "${record}"
		done
	fi
}

validate_current_state() {
	local source_sha=$1
	active_database_sha=$(cat "${database_file}" 2>/dev/null || true)
	active_grant_sha=$(cat "${grant_file}" 2>/dev/null || true)
	active_contract_sha=$(cat "${database_contract_file}" 2>/dev/null || true)
	active_runtime_contract_sha=$(cat "${runtime_contract_file}" 2>/dev/null || true)
	local record database_release_dir source_release_dir
	record=$(cat "${current_record_file}" 2>/dev/null || true)
	if [[ ! "${source_sha}" =~ ^[0-9a-f]{40}$ ]] ||
		[[ ! "${active_database_sha}" =~ ^[0-9a-f]{40}$ ]] ||
		[[ ! "${active_grant_sha}" =~ ^[0-9a-f]{64}$ ]] ||
		[[ ! "${active_contract_sha}" =~ ^[0-9a-f]{64}$ ]] ||
		[[ ! "${active_runtime_contract_sha}" =~ ^[0-9a-f]{64}$ ]]; then
		echo "Current release state is incomplete" >&2
		exit 1
	fi
	database_release_dir="${releases_dir}/${active_database_sha}"
	source_release_dir="${releases_dir}/${source_sha}"
	if [[ ! -d "${database_release_dir}/.git" ]] ||
		[[ $(runtime_grant_sha "${database_release_dir}") != "${active_grant_sha}" ]] ||
		[[ $(database_contract_sha "${database_release_dir}") != "${active_contract_sha}" ]]; then
		echo "Current database release evidence does not match its immutable checkout" >&2
		exit 1
	fi
	if [[ ! -d "${source_release_dir}/.git" ]] ||
		[[ $(runtime_infrastructure_contract_sha "${source_release_dir}") != \
			"${active_runtime_contract_sha}" ]]; then
		echo "Current runtime infrastructure evidence does not match its immutable checkout" >&2
		exit 1
	fi
	validate_record \
		"${record}" "${source_sha}" "${active_database_sha}" \
		"${active_grant_sha}" "${active_contract_sha}" \
		"${active_runtime_contract_sha}"
}

compatibility_proof_path() {
	printf '%s/%s-%s-%s.json\n' \
		"${compatibility_dir}" "$1" "$2" "$3"
}

validate_compatibility_proof() {
	local proof=$1 from_sha=$2 to_sha=$3 database_sha=$4 grant_sha=$5
	local database_contract_sha=$6 runtime_contract_sha=$7
	local from_manifest_sha to_manifest_sha
	[[ -f "${proof}" ]] || {
		echo "Rollback compatibility proof is unavailable" >&2
		exit 1
	}
	from_manifest_sha=$(image_manifest_sha "${from_sha}")
	to_manifest_sha=$(image_manifest_sha "${to_sha}")
	grep -Fq "\"fromReleaseId\": \"${from_sha}\"" "${proof}"
	grep -Fq "\"toReleaseId\": \"${to_sha}\"" "${proof}"
	grep -Fq "\"databaseReleaseId\": \"${database_sha}\"" "${proof}"
	grep -Fq "\"runtimeGrantSha256\": \"${grant_sha}\"" "${proof}"
	grep -Fq \
		"\"databaseCompatibilitySha256\": \"${database_contract_sha}\"" "${proof}"
	grep -Fq \
		"\"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"" \
		"${proof}"
	grep -Fq \
		"\"fromImageManifestSha256\": \"${from_manifest_sha}\"" "${proof}"
	grep -Fq \
		"\"toImageManifestSha256\": \"${to_manifest_sha}\"" "${proof}"
	grep -Fq '"kind": "identical-database-and-runtime-contract"' "${proof}"
}

write_compatibility_proof() {
	local from_sha=$1 to_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
	local proof temporary from_manifest_sha to_manifest_sha
	proof=$(compatibility_proof_path "${from_sha}" "${to_sha}" "${database_sha}")
	if [[ -f "${proof}" ]]; then
		validate_compatibility_proof \
			"${proof}" "${from_sha}" "${to_sha}" "${database_sha}" \
			"${grant_sha}" "${database_contract_sha}" "${runtime_contract_sha}"
		printf '%s\n' "${proof}"
		return
	fi
	from_manifest_sha=$(image_manifest_sha "${from_sha}")
	to_manifest_sha=$(image_manifest_sha "${to_sha}")
	temporary=$(mktemp "${compatibility_dir}/.proof.XXXXXX")
	printf '%s\n' \
		'{' \
		'  "schemaVersion": 2,' \
		'  "environment": "staging",' \
		'  "kind": "identical-database-and-runtime-contract",' \
		"  \"fromReleaseId\": \"${from_sha}\"," \
		"  \"toReleaseId\": \"${to_sha}\"," \
		"  \"databaseReleaseId\": \"${database_sha}\"," \
		"  \"runtimeGrantSha256\": \"${grant_sha}\"," \
		"  \"databaseCompatibilitySha256\": \"${database_contract_sha}\"," \
		"  \"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"," \
		"  \"fromImageManifestSha256\": \"${from_manifest_sha}\"," \
		"  \"toImageManifestSha256\": \"${to_manifest_sha}\"," \
		"  \"verifiedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" \
		'}' >"${temporary}"
	chmod 0600 "${temporary}"
	mv "${temporary}" "${proof}"
	printf '%s\n' "${proof}"
}

install_caddy() {
	local release_dir=$1
	install -o root -g root -m 0644 \
		"${release_dir}/infra/staging/Caddyfile" /etc/caddy/Caddyfile
	caddy validate --config /etc/caddy/Caddyfile >/dev/null
	systemctl enable --now caddy >/dev/null
	systemctl reload caddy
}

refresh_tls_bundle() {
	local certificate_root=/var/lib/caddy/.local/share/caddy/certificates
	local certificate key temporary
	for _ in $(seq 1 60); do
		certificate=$(find "${certificate_root}" -type f \
			-path '*/staging.crew-haus.com/staging.crew-haus.com.crt' \
			-print -quit 2>/dev/null || true)
		key=$(find "${certificate_root}" -type f \
			-path '*/staging.crew-haus.com/staging.crew-haus.com.key' \
			-print -quit 2>/dev/null || true)
		[[ -n "${certificate}" && -n "${key}" ]] && break
		sleep 1
	done
	if [[ -z "${certificate:-}" || -z "${key:-}" ]]; then
		echo "Caddy did not provision the staging TLS certificate" >&2
		exit 1
	fi
	openssl x509 -in "${certificate}" -checkhost staging.crew-haus.com -noout
	temporary=$(mktemp "${shared_dir}/tls/.staging.XXXXXX")
	cat "${certificate}" "${key}" >"${temporary}"
	chmod 0444 "${temporary}"
	mv "${temporary}" "${shared_dir}/tls/staging.pem"
}

write_digest_override() {
	local temporary
	temporary=$(mktemp "${shared_dir}/.compose.digest.XXXXXX")
	cat >"${temporary}" <<EOF
services:
  redis-rate-limit:
    image: ${rate_limit_redis_image}
    pull_policy: never
  jwt-bootstrap:
    image: ${infra_image}
    pull_policy: never
  user-migrate:
    image: ${user_service_image}
    pull_policy: never
  event-migrate:
    image: ${event_service_image}
    pull_policy: never
  provider-sink:
    image: ${infra_image}
    pull_policy: never
  user-api:
    image: ${user_service_image}
    pull_policy: never
  event-api:
    image: ${event_service_image}
    pull_policy: never
  place-golf-import:
    image: ${event_service_image}
    pull_policy: never
  place-search-reindex:
    image: ${event_service_image}
    pull_policy: never
  magic-worker:
    image: ${user_service_image}
    pull_policy: never
  push-worker:
    image: ${user_service_image}
    pull_policy: never
  attachment-worker:
    image: ${event_service_image}
    pull_policy: never
  notification-worker:
    image: ${event_service_image}
    pull_policy: never
  recap-retention-worker:
    image: ${event_service_image}
    pull_policy: never
  api-gateway:
    image: ${api_gateway_image}
    pull_policy: never
  fixture-bootstrap:
    image: ${infra_image}
    pull_policy: never
  web:
    image: ${web_image}
    pull_policy: never
EOF
	chmod 0600 "${temporary}"
	mv "${temporary}" "${digest_override_file}"
	image_distribution_override_sha=$(
		sha256sum "${digest_override_file}" | cut -d ' ' -f 1
	)
}

pull_release_images() {
	local name reference revision source repo_digests
	while IFS='=' read -r name reference; do
		docker pull "${reference}" >/dev/null
		revision=$(docker image inspect "${reference}" \
			--format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
		source=$(docker image inspect "${reference}" \
			--format '{{index .Config.Labels "org.opencontainers.image.source"}}')
		repo_digests=$(docker image inspect "${reference}" \
			--format '{{json .RepoDigests}}')
		if [[ "${revision}" != "${target_sha}" ]] ||
			[[ "${source}" != "https://github.com/dischen87/crew" ]] ||
			[[ "${repo_digests}" != *"\"${reference}\""* ]]; then
			echo "Pulled ${name} image does not match its immutable manifest" >&2
			exit 1
		fi
	done <<EOF
api-gateway=${api_gateway_image}
user-service=${user_service_image}
event-service=${event_service_image}
infra=${infra_image}
rate-limit-redis=${rate_limit_redis_image}
web=${web_image}
EOF
}

compose_command() {
	local release_dir=$1
	shift
	CREW_RELEASE_SHA="${target_sha}" \
		CREW_DEPLOY_ASSET_DIR="${release_dir}/infra/staging" \
		CREW_DEPLOY_SHARED_DIR="${shared_dir}" \
		docker compose \
		--project-name crew-next-staging \
		--project-directory "${release_dir}" \
		--env-file "${environment_file}" \
		--file "${release_dir}/compose.yaml" \
		--file "${release_dir}/infra/staging/compose.staging.yaml" \
		--file "${digest_override_file}" \
		"$@"
}

run_job() {
	local release_dir=$1
	local service=$2
	compose_command "${release_dir}" up \
		--no-build --no-deps --force-recreate --abort-on-container-exit \
		--exit-code-from "${service}" "${service}"
}

wait_for_service() {
	local release_dir=$1
	local service=$2
	for _ in $(seq 1 90); do
		local container state health
		container=$(compose_command "${release_dir}" ps -q "${service}")
		if [[ -n "${container}" ]]; then
			state=$(docker inspect --format '{{.State.Status}}' "${container}")
			health=$(docker inspect \
				--format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
				"${container}")
			if [[ "${state}" == running &&
				("${health}" == healthy || "${health}" == none) ]]; then
				return
			fi
		fi
		sleep 2
	done
	echo "Service ${service} did not become ready" >&2
	compose_command "${release_dir}" ps --all >&2
	exit 1
}

verify_service_image_references() {
	local release_dir=$1 service expected container actual
	while IFS='=' read -r service expected; do
		container=$(compose_command "${release_dir}" ps -q --all "${service}")
		[[ -n "${container}" ]] || {
			echo "Container is unavailable for ${service}" >&2
			exit 1
		}
		actual=$(docker inspect --format '{{.Config.Image}}' "${container}")
		[[ "${actual}" == "${expected}" ]] || {
			echo "Container ${service} is not bound to its recorded digest" >&2
			exit 1
		}
	done <<EOF
redis-rate-limit=${rate_limit_redis_image}
provider-sink=${infra_image}
user-api=${user_service_image}
event-api=${event_service_image}
magic-worker=${user_service_image}
push-worker=${user_service_image}
attachment-worker=${event_service_image}
notification-worker=${event_service_image}
recap-retention-worker=${event_service_image}
api-gateway=${api_gateway_image}
web=${web_image}
EOF
}

ensure_typesense_search_key() {
	local admin_key search_key search_status create_status key_list_status
	admin_key=$(environment_value TYPESENSE_API_KEY)
	search_key=$(environment_value TYPESENSE_SEARCH_API_KEY)
	if [[ "${admin_key}" == "${search_key}" ]]; then
		echo "Typesense admin and search-only keys must be different" >&2
		exit 1
	fi

	search_status=$(curl --silent --show-error --output /dev/null \
		--max-time 10 \
		--write-out '%{http_code}' \
		--header "X-TYPESENSE-API-KEY: ${search_key}" \
		"http://127.0.0.1:8108/collections/crew_places/documents/search?q=%2A&query_by=name&per_page=1")
	if [[ "${search_status}" == 401 || "${search_status}" == 403 ]]; then
		create_status=$(
			printf '%s\n' \
				'{' \
				'  "description": "Crew place search only",' \
				'  "actions": ["documents:search"],' \
				'  "collections": ["crew_places.*"],' \
				"  \"value\": \"${search_key}\"" \
				'}' |
				curl --silent --show-error --output /dev/null \
					--max-time 10 \
					--write-out '%{http_code}' \
					--request POST \
					--header "X-TYPESENSE-API-KEY: ${admin_key}" \
					--header "Content-Type: application/json" \
					--data-binary @- \
					http://127.0.0.1:8108/keys
		)
		if [[ "${create_status}" != 201 ]]; then
			echo "Typesense search-only key provisioning failed" >&2
			exit 1
		fi
	elif [[ "${search_status}" != 200 && "${search_status}" != 404 ]]; then
		echo "Typesense search-only key cannot search the Crew collection" >&2
		exit 1
	fi

	key_list_status=$(curl --silent --show-error --output /dev/null \
		--max-time 10 \
		--write-out '%{http_code}' \
		--header "X-TYPESENSE-API-KEY: ${search_key}" \
		http://127.0.0.1:8108/keys)
	if [[ "${key_list_status}" != 401 && "${key_list_status}" != 403 ]]; then
		echo "Typesense search-only key unexpectedly has key-management access" >&2
		exit 1
	fi
}

verify_typesense_search_key() {
	local search_key search_status
	search_key=$(environment_value TYPESENSE_SEARCH_API_KEY)
	search_status=$(curl --silent --show-error --output /dev/null \
		--max-time 10 \
		--write-out '%{http_code}' \
		--header "X-TYPESENSE-API-KEY: ${search_key}" \
		"http://127.0.0.1:8108/collections/crew_places/documents/search?q=%2A&query_by=name&per_page=1")
	if [[ "${search_status}" != 200 ]]; then
		echo "Typesense search-only key failed the indexed Crew search probe" >&2
		exit 1
	fi
}

smoke() {
	local release_dir=$1
	local readiness openapi auth_run_id
	auth_run_id=$(openssl rand -hex 12)
	readiness=$(curl --fail --silent --show-error --retry 12 \
		--retry-delay 2 https://staging.crew-haus.com/internal/ready)
	grep -q '"status":"ready"' <<<"${readiness}"
	openapi=$(curl --fail --silent --show-error --retry 6 \
		--retry-delay 2 https://staging.crew-haus.com/docs/openapi.json)
	grep -q '"openapi":"3.1.0"' <<<"${openapi}"
	curl --fail --silent --show-error --retry 6 \
		--retry-delay 2 https://crew-haus.com/ |
		grep -Fq 'Der gemeinsame Plan für eure Gruppe.'
	curl --fail --silent --show-error --retry 6 \
		https://staging.crew-haus.com:8444/minio/health/ready >/dev/null

	compose_command "${release_dir}" exec -T event-api bun -e \
		"const r=await fetch('https://staging.crew-haus.com:8445/health');if(!r.ok)process.exit(1)"

	compose_command "${release_dir}" run --rm --no-deps \
		-e CREW_FIXTURE_AUTH_RUN_ID="${auth_run_id}" \
		-e CREW_FIXTURE_SCENARIO=golf-tour fixture-bootstrap
	compose_command "${release_dir}" run --rm --no-deps \
		-e CREW_FIXTURE_AUTH_RUN_ID="${auth_run_id}" \
		-e CREW_FIXTURE_ATTACHMENT_E2E=1 \
		-e CREW_FIXTURE_SCENARIO=team-event fixture-bootstrap
}

record_release() {
	local release_action=$1
	local from_sha=$2
	local database_sha=$3
	local compatibility_proof=${4:-}
	local recorded_at database_release_dir grant_sha contract_sha runtime_contract_sha
	local api_gateway_image_id user_service_image_id event_service_image_id
	local infra_image_id rate_limit_redis_image_id web_image_id internal_tls_image_id
	local internal_tls_reference proof_json record
	recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
	database_release_dir="${releases_dir}/${database_sha}"
	if [[ ! "${database_sha}" =~ ^[0-9a-f]{40}$ ]] ||
		[[ ! -f "${database_release_dir}/infra/postgres/grant-runtime.sql" ]]; then
		echo "Database release input is unavailable for ${database_sha}" >&2
		exit 1
	fi
	grant_sha=$(runtime_grant_sha "${database_release_dir}")
	contract_sha=$(database_contract_sha "${database_release_dir}")
	runtime_contract_sha=$(runtime_infrastructure_contract_sha "${release_dir}")
	proof_json=null
	if [[ -n "${compatibility_proof}" ]]; then
		proof_json="\"$(basename "${compatibility_proof}")\""
	fi
	internal_tls_reference="haproxy:3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb"
	api_gateway_image_id=$(docker image inspect "${api_gateway_image}" \
		--format '{{.Id}}')
	user_service_image_id=$(docker image inspect "${user_service_image}" \
		--format '{{.Id}}')
	event_service_image_id=$(docker image inspect "${event_service_image}" \
		--format '{{.Id}}')
	infra_image_id=$(docker image inspect "${infra_image}" --format '{{.Id}}')
	rate_limit_redis_image_id=$(docker image inspect \
		"${rate_limit_redis_image}" --format '{{.Id}}')
	web_image_id=$(docker image inspect "${web_image}" --format '{{.Id}}')
	internal_tls_image_id=$(docker image inspect \
		"${internal_tls_reference}" --format '{{.Id}}')
	local temporary="${records_dir}/.${target_sha}.${release_action}.tmp"
	record="${records_dir}/${recorded_at//:/-}-${release_action}-${target_sha}.json"
	printf '%s\n' \
		'{' \
		'  "schemaVersion": 2,' \
		'  "environment": "staging",' \
		"  \"action\": \"${release_action}\"," \
		"  \"fromReleaseId\": \"${from_sha}\"," \
		"  \"releaseId\": \"${target_sha}\"," \
		"  \"databaseReleaseId\": \"${database_sha}\"," \
		"  \"recordedAt\": \"${recorded_at}\"," \
		'  "publicGatewayOrigin": "https://staging.crew-haus.com",' \
		'  "mobileGatewayBaseUrl": "https://staging.crew-haus.com",' \
		'  "features": {"placeEnrichment": "disabled-no-provider-worker"},' \
		"  \"runtimeGrantSha256\": \"${grant_sha}\"," \
		"  \"databaseCompatibilitySha256\": \"${contract_sha}\"," \
		"  \"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"," \
		"  \"imageManifestSha256\": \"${target_manifest_sha}\"," \
		"  \"imageDistributionOverrideSha256\": \"${image_distribution_override_sha}\"," \
		"  \"rollbackCompatibilityProof\": ${proof_json}," \
		'  "images": {' \
		"    \"api-gateway\": \"${api_gateway_image}\"," \
		"    \"user-service\": \"${user_service_image}\"," \
		"    \"event-service\": \"${event_service_image}\"," \
		"    \"infra\": \"${infra_image}\"," \
		"    \"rate-limit-redis\": \"${rate_limit_redis_image}\"," \
		"    \"web\": \"${web_image}\"," \
		"    \"internal-tls\": \"${internal_tls_reference}\"" \
		'  },' \
		'  "localImageIds": {' \
		"    \"api-gateway\": \"${api_gateway_image_id}\"," \
		"    \"user-service\": \"${user_service_image_id}\"," \
		"    \"event-service\": \"${event_service_image_id}\"," \
		"    \"infra\": \"${infra_image_id}\"," \
		"    \"rate-limit-redis\": \"${rate_limit_redis_image_id}\"," \
		"    \"web\": \"${web_image_id}\"," \
		"    \"internal-tls\": \"${internal_tls_image_id}\"" \
		'  },' \
		'  "smoke": ["ready", "openapi-3.1", "public-web", "https-object-store", "tls-search", "golf-fixture", "team-fixture", "feedback-attachment-e2e"]' \
		'}' >"${temporary}"
	chmod 0600 "${temporary}"
	mv "${temporary}" "${record}"
	printf '%s\n' "${record}"
}

activate_release_state() {
	local release_sha=$1 database_sha=$2 record=$3
	local database_release_dir="${releases_dir}/${database_sha}"
	local release_dir="${releases_dir}/${release_sha}"
	printf '%s\n' "${release_sha}" >"${current_file}"
	printf '%s\n' "${database_sha}" >"${database_file}"
	runtime_grant_sha "${database_release_dir}" >"${grant_file}"
	database_contract_sha "${database_release_dir}" >"${database_contract_file}"
	runtime_infrastructure_contract_sha "${release_dir}" >"${runtime_contract_file}"
	printf '%s\n' "${record}" >"${current_record_file}"
	ln -sfn "${releases_dir}/${release_sha}" "${deploy_root}/current"
}

ensure_environment
release_dir=$(checkout_release)
chmod -R a=rX -- "${release_dir}"
load_target_image_manifest
pull_release_images
write_digest_override
compose_command "${release_dir}" config --quiet
source_sha=$(cat "${current_file}" 2>/dev/null || true)
active_database_sha=
active_grant_sha=
active_contract_sha=
active_runtime_contract_sha=
compatibility_proof=
target_contract_sha=$(database_contract_sha "${release_dir}")
target_grant_sha=$(runtime_grant_sha "${release_dir}")
target_runtime_contract_sha=$(runtime_infrastructure_contract_sha "${release_dir}")

if [[ "${action}" == deploy ]]; then
	if [[ -n "${source_sha}" ]]; then
		validate_current_state "${source_sha}"
		source_release_dir="${releases_dir}/${source_sha}"
		if [[ ! -d "${source_release_dir}/.git" ]] ||
			[[ $(database_contract_sha "${source_release_dir}") != "${active_contract_sha}" ]] ||
			[[ "${target_contract_sha}" != "${active_contract_sha}" ]] ||
			[[ "${target_grant_sha}" != "${active_grant_sha}" ]] ||
			[[ "${target_runtime_contract_sha}" != \
				"${active_runtime_contract_sha}" ]]; then
			echo "Forward deploy changes the database or runtime infrastructure contract; richer rollback evidence is required" >&2
			exit 1
		fi
		if [[ "${source_sha}" != "${target_sha}" ]]; then
			compatibility_proof=$(write_compatibility_proof \
				"${target_sha}" "${source_sha}" "${target_sha}" \
				"${target_grant_sha}" "${target_contract_sha}" \
				"${target_runtime_contract_sha}")
		fi
	elif [[ -e "${database_file}" || -e "${grant_file}" ||
		-e "${database_contract_file}" || -e "${runtime_contract_file}" ||
		-e "${current_record_file}" ]]; then
		echo "Greenfield bootstrap state is inconsistent" >&2
		exit 1
	fi
else
	if [[ -z "${source_sha}" || "${source_sha}" == "${target_sha}" ]]; then
		echo "Rollback requires a different currently deployed release" >&2
		exit 1
	fi
	validate_current_state "${source_sha}"
	if [[ "${target_contract_sha}" != "${active_contract_sha}" ]] ||
		[[ "${target_grant_sha}" != "${active_grant_sha}" ]] ||
		[[ "${target_runtime_contract_sha}" != \
			"${active_runtime_contract_sha}" ]]; then
		echo "Rollback target is not compatible with the active database or runtime infrastructure contract" >&2
		exit 1
	fi
	compatibility_proof=$(compatibility_proof_path \
		"${source_sha}" "${target_sha}" "${active_database_sha}")
	validate_compatibility_proof \
		"${compatibility_proof}" "${source_sha}" "${target_sha}" \
		"${active_database_sha}" "${active_grant_sha}" "${active_contract_sha}" \
		"${active_runtime_contract_sha}"
fi

install_caddy "${release_dir}"
refresh_tls_bundle

if [[ "${action}" == deploy ]]; then
	compose_command "${release_dir}" up -d --no-build \
		postgres redis-rate-limit minio typesense provider-sink internal-tls
	for service in postgres redis-rate-limit minio typesense provider-sink internal-tls; do
		wait_for_service "${release_dir}" "${service}"
	done
	ensure_typesense_search_key

	for job in jwt-bootstrap user-migrate event-migrate db-grants minio-bootstrap; do
		run_job "${release_dir}" "${job}"
	done

	compose_command "${release_dir}" up -d --no-build \
		user-api event-api magic-worker push-worker attachment-worker \
		notification-worker recap-retention-worker api-gateway web
	for service in user-api event-api magic-worker push-worker attachment-worker \
		notification-worker recap-retention-worker api-gateway web; do
		wait_for_service "${release_dir}" "${service}"
	done
	run_job "${release_dir}" place-golf-import
	run_job "${release_dir}" place-search-reindex
	verify_typesense_search_key
	smoke "${release_dir}"
	verify_service_image_references "${release_dir}"
	if [[ -n "${source_sha}" && "${source_sha}" != "${target_sha}" ]]; then
		printf '%s\n' "${source_sha}" >"${previous_file}"
	fi
	release_record=$(record_release \
		deploy "${source_sha}" "${target_sha}" "${compatibility_proof}")
	activate_release_state "${target_sha}" "${target_sha}" "${release_record}"
else
	compose_command "${release_dir}" up -d --no-build --no-deps \
		--force-recreate redis-rate-limit provider-sink internal-tls
	for service in redis-rate-limit provider-sink internal-tls; do
		wait_for_service "${release_dir}" "${service}"
	done
	ensure_typesense_search_key
	verify_typesense_search_key
	compose_command "${release_dir}" up -d --no-build --no-deps api-gateway
	wait_for_service "${release_dir}" api-gateway
	compose_command "${release_dir}" up -d --no-build --no-deps \
		event-api attachment-worker notification-worker recap-retention-worker
	for service in event-api attachment-worker notification-worker recap-retention-worker; do
		wait_for_service "${release_dir}" "${service}"
	done
	compose_command "${release_dir}" up -d --no-build --no-deps \
		user-api magic-worker push-worker web
	for service in user-api magic-worker push-worker web; do
		wait_for_service "${release_dir}" "${service}"
	done
	smoke "${release_dir}"
	verify_service_image_references "${release_dir}"
	printf '%s\n' "${source_sha}" >"${previous_file}"
	release_record=$(record_release \
		rollback "${source_sha}" "${active_database_sha}" "${compatibility_proof}")
	activate_release_state \
		"${target_sha}" "${active_database_sha}" "${release_record}"
fi

compose_command "${release_dir}" ps
