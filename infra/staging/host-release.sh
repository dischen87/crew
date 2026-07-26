#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
target_sha=${2:-}
repository=${CREW_REPOSITORY_URL:-https://github.com/dischen87/crew.git}
deploy_root=${CREW_DEPLOY_ROOT:-/opt/crew-new}
releases_dir="${deploy_root}/releases"
shared_dir="${deploy_root}/shared"
environment_file="${shared_dir}/environment"
records_dir="${shared_dir}/records"
compatibility_dir="${records_dir}/compatibility"
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
	"${releases_dir}" "${shared_dir}/tls" "${records_dir}" "${compatibility_dir}"
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

validate_record() {
	local record=$1 release_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
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
	for image in provider-sink rate-limit-redis internal-tls; do
		grep -Eq "\"${image}\": \"sha256:[a-f0-9]{64}\"" "${record}"
	done
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
	[[ -f "${proof}" ]] || {
		echo "Rollback compatibility proof is unavailable" >&2
		exit 1
	}
	grep -Fq "\"fromReleaseId\": \"${from_sha}\"" "${proof}"
	grep -Fq "\"toReleaseId\": \"${to_sha}\"" "${proof}"
	grep -Fq "\"databaseReleaseId\": \"${database_sha}\"" "${proof}"
	grep -Fq "\"runtimeGrantSha256\": \"${grant_sha}\"" "${proof}"
	grep -Fq \
		"\"databaseCompatibilitySha256\": \"${database_contract_sha}\"" "${proof}"
	grep -Fq \
		"\"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"" \
		"${proof}"
	grep -Fq '"kind": "identical-database-and-runtime-contract"' "${proof}"
}

write_compatibility_proof() {
	local from_sha=$1 to_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
	local proof temporary
	proof=$(compatibility_proof_path "${from_sha}" "${to_sha}" "${database_sha}")
	if [[ -f "${proof}" ]]; then
		validate_compatibility_proof \
			"${proof}" "${from_sha}" "${to_sha}" "${database_sha}" \
			"${grant_sha}" "${database_contract_sha}" "${runtime_contract_sha}"
		printf '%s\n' "${proof}"
		return
	fi
	temporary=$(mktemp "${compatibility_dir}/.proof.XXXXXX")
	printf '%s\n' \
		'{' \
		'  "schemaVersion": 1,' \
		'  "environment": "staging",' \
		'  "kind": "identical-database-and-runtime-contract",' \
		"  \"fromReleaseId\": \"${from_sha}\"," \
		"  \"toReleaseId\": \"${to_sha}\"," \
		"  \"databaseReleaseId\": \"${database_sha}\"," \
		"  \"runtimeGrantSha256\": \"${grant_sha}\"," \
		"  \"databaseCompatibilitySha256\": \"${database_contract_sha}\"," \
		"  \"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"," \
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

build_images() {
	local release_dir=$1
	local revision_label="org.opencontainers.image.revision=${target_sha}"
	docker build --pull --label "${revision_label}" \
		--file "${release_dir}/services/api-gateway/Dockerfile" \
		--tag "crew-next-api-gateway:${target_sha}" "${release_dir}"
	docker build --pull --label "${revision_label}" \
		--file "${release_dir}/services/user-service/Dockerfile" \
		--tag "crew-next-user-service:${target_sha}" "${release_dir}"
	docker build --pull --label "${revision_label}" \
		--file "${release_dir}/services/event-service/Dockerfile" \
		--tag "crew-next-event-service:${target_sha}" "${release_dir}"
	docker build --pull --label "${revision_label}" \
		--file "${release_dir}/infra/Dockerfile" \
		--tag "crew-next-infra:${target_sha}" "${release_dir}"
	docker build --pull --label "${revision_label}" \
		--file "${release_dir}/infra/redis/Dockerfile" \
		--tag "crew-next-rate-limit-redis:${target_sha}" "${release_dir}"
	git -C "${release_dir}" archive --format=tar "${target_sha}" -- \
		package.json bun.lock \
		apps/web apps/mobile/package.json apps/mobile/assets/fonts \
		apps/mobile/src/assets \
		apps/mobile/evidence/event-hub-option-2/reference-390x844.png \
		packages/mobile-client/package.json packages/mobile-data/package.json \
		packages/shared/package.json services/api-gateway/package.json \
		services/user-service/package.json services/event-service/package.json |
		docker build --pull --label "${revision_label}" \
			--file apps/web/Dockerfile \
			--tag "crew-next-web:${target_sha}" -
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
	local gateway_image user_image event_image web_image provider_sink_image
	local rate_limit_redis_image internal_tls_image proof_json record
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
	gateway_image=$(docker image inspect "crew-next-api-gateway:${target_sha}" \
		--format '{{.Id}}')
	user_image=$(docker image inspect "crew-next-user-service:${target_sha}" \
		--format '{{.Id}}')
	event_image=$(docker image inspect "crew-next-event-service:${target_sha}" \
		--format '{{.Id}}')
	web_image=$(docker image inspect "crew-next-web:${target_sha}" \
		--format '{{.Id}}')
	provider_sink_image=$(docker image inspect "crew-next-infra:${target_sha}" \
		--format '{{.Id}}')
	rate_limit_redis_image=$(docker image inspect \
		"crew-next-rate-limit-redis:${target_sha}" --format '{{.Id}}')
	internal_tls_image=$(docker image inspect \
		"haproxy:3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb" \
		--format '{{.Id}}')
	local temporary="${records_dir}/.${target_sha}.${release_action}.tmp"
	record="${records_dir}/${recorded_at//:/-}-${release_action}-${target_sha}.json"
	printf '%s\n' \
		'{' \
		'  "schemaVersion": 1,' \
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
		"  \"rollbackCompatibilityProof\": ${proof_json}," \
		'  "images": {' \
		"    \"api-gateway\": \"${gateway_image}\"," \
		"    \"user-service\": \"${user_image}\"," \
		"    \"event-service\": \"${event_image}\"," \
		"    \"web\": \"${web_image}\"," \
		"    \"provider-sink\": \"${provider_sink_image}\"," \
		"    \"rate-limit-redis\": \"${rate_limit_redis_image}\"," \
		"    \"internal-tls\": \"${internal_tls_image}\"" \
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
		compatibility_proof=$(write_compatibility_proof \
			"${target_sha}" "${source_sha}" "${target_sha}" \
			"${target_grant_sha}" "${target_contract_sha}" \
			"${target_runtime_contract_sha}")
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
build_images "${release_dir}"

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
	printf '%s\n' "${source_sha}" >"${previous_file}"
	release_record=$(record_release \
		rollback "${source_sha}" "${active_database_sha}" "${compatibility_proof}")
	activate_release_state \
		"${target_sha}" "${active_database_sha}" "${release_record}"
fi

compose_command "${release_dir}" ps
