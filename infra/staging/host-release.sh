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
reset_records_dir="${records_dir}/resets"
manifests_dir="${shared_dir}/manifests"
digest_override_file="${shared_dir}/compose.digest.yaml"
current_file="${shared_dir}/current-release"
previous_file="${shared_dir}/previous-release"
database_file="${shared_dir}/database-release"
database_lineage_file="${shared_dir}/database-lineage"
grant_file="${shared_dir}/runtime-grant-sha256"
database_contract_file="${shared_dir}/database-contract-sha256"
runtime_contract_file="${shared_dir}/runtime-infrastructure-contract-sha256"
current_record_file="${shared_dir}/current-record"
reset_consumed_file="${reset_records_dir}/greenfield-reset-consumed.json"
reset_in_progress_file="${shared_dir}/reset-in-progress"
lock_file="${shared_dir}/deploy.lock"
reset_staging_data=false

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
	"${compatibility_dir}" "${reset_records_dir}" "${manifests_dir}"
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
	local allow_reset_intent=$5
	python3 - "${source}" "${canonical}" "${environment_output}" \
		"${expected_sha}" "${allow_reset_intent}" <<'PY'
import json
import re
import sys

source, canonical_path, environment_path, expected_sha, allow_reset_intent = sys.argv[1:]
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
if not isinstance(manifest, dict):
    raise SystemExit("Image manifest fields are invalid")
reset_intent = manifest.pop("resetStaging", None)
reset_staging_data = reset_intent is not None
reset_id = ""
reset_expected_current_sha = ""
if reset_staging_data:
    if allow_reset_intent != "true":
        raise SystemExit("Stored image manifests cannot request a staging reset")
    if not isinstance(reset_intent, dict) or set(reset_intent) != {
        "id", "environment", "expectedCurrentReleaseId"
    }:
        raise SystemExit("Staging reset intent fields are invalid")
    reset_id = reset_intent["id"]
    reset_expected_current_sha = reset_intent["expectedCurrentReleaseId"]
    if not isinstance(reset_id, str) or not re.fullmatch(
        r"github-actions-[0-9]+", reset_id
    ):
        raise SystemExit("Staging reset intent ID is invalid")
    if reset_intent["environment"] != "crew-next-staging":
        raise SystemExit("Staging reset environment is invalid")
    if not isinstance(reset_expected_current_sha, str) or not re.fullmatch(
        r"[0-9a-f]{40}", reset_expected_current_sha
    ):
        raise SystemExit("Expected current staging release is invalid")
if set(manifest) != {"schemaVersion", "releaseId", "platform", "images"}:
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
        output.write(
            f"reset_staging_data={'true' if reset_staging_data else 'false'}\n"
        )
        output.write(f"reset_id={reset_id}\n")
        output.write(f"reset_expected_current_sha={reset_expected_current_sha}\n")
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
	canonicalize_image_manifest \
		"${manifest}" "${canonical}" - "${release_sha}" false
	sha256sum "${canonical}" | cut -d ' ' -f 1
	rm -f "${canonical}"
}

load_target_image_manifest() {
	local manifest="${manifests_dir}/${target_sha}.json"
	local source=${CREW_IMAGE_MANIFEST_SOURCE:-}
	local canonical environment_output existing_canonical
	local requested_reset=false requested_reset_id requested_reset_expected_sha
	canonical=$(mktemp "${manifests_dir}/.canonical.XXXXXX")
	environment_output=$(mktemp "${manifests_dir}/.environment.XXXXXX")
	if [[ -n "${source}" ]]; then
		[[ -f "${source}" ]] || {
			echo "Provided image manifest is unavailable" >&2
			exit 1
		}
		canonicalize_image_manifest \
			"${source}" "${canonical}" "${environment_output}" "${target_sha}" true
		# Reset reruns keep the first immutable image set even if Buildx republishes
		# the same Git SHA with different provenance metadata.
		source "${environment_output}"
		requested_reset=${reset_staging_data}
		requested_reset_id=${reset_id}
		requested_reset_expected_sha=${reset_expected_current_sha}
		if [[ -f "${manifest}" ]]; then
			[[ ! -L "${manifest}" &&
				$(stat -c '%U:%G:%a' "${manifest}") == root:root:600 ]] || {
				echo "Stored image manifest ownership or mode is invalid" >&2
				exit 1
			}
			existing_canonical=$(mktemp "${manifests_dir}/.existing.XXXXXX")
			canonicalize_image_manifest \
				"${manifest}" "${existing_canonical}" - "${target_sha}" false
			if ! cmp --silent "${canonical}" "${existing_canonical}"; then
				[[ "${requested_reset}" == true ]] || {
					echo "Stored image manifest differs for ${target_sha}" >&2
					exit 1
				}
				canonicalize_image_manifest \
					"${manifest}" "${canonical}" "${environment_output}" \
					"${target_sha}" false
				printf '%s\n' \
					"reset_staging_data=true" \
					"reset_id=${requested_reset_id}" \
					"reset_expected_current_sha=${requested_reset_expected_sha}" \
					>>"${environment_output}"
			fi
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
			"${manifest}" "${canonical}" "${environment_output}" "${target_sha}" false
	fi
	# Values are constrained above to fixed GHCR paths and lowercase digests.
	source "${environment_output}"
	target_manifest_sha=$(sha256sum "${canonical}" | cut -d ' ' -f 1)
	rm -f "${canonical}" "${environment_output}"
}

active_record_path() {
	local release_sha=$1
	local pointer="${records_dir}/active-${release_sha}.record"
	if [[ -e "${pointer}" ]]; then
		[[ -f "${pointer}" && ! -L "${pointer}" &&
			$(stat -c '%U:%G:%a' "${pointer}") == root:root:600 ]] || {
			echo "Active release record pointer is invalid" >&2
			exit 1
		}
		cat "${pointer}"
	else
		[[ -f "${current_record_file}" && ! -L "${current_record_file}" ]] || {
			echo "Current release record pointer is unavailable" >&2
			exit 1
		}
		cat "${current_record_file}"
	fi
}

validate_record() {
	local record=$1 release_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
	local database_lineage_id=${7:-}
	local manifest manifest_sha
	[[ "${record}" == "${records_dir}/"* && -f "${record}" && ! -L "${record}" ]] ||
		{
			echo "Current release record is unavailable" >&2
			exit 1
		}
	[[ $(stat -c '%U:%G:%a' "${record}") == root:root:600 ]] || {
		echo "Current release record ownership or mode is invalid" >&2
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
	if [[ -n "${database_lineage_id}" ]]; then
		grep -Fq \
			"\"databaseLineageId\": \"${database_lineage_id}\"" "${record}"
	fi
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
	local state database_release_dir source_release_dir
	local boundary_reset_id completion
	active_record=$(active_record_path "${source_sha}")
	state=$(python3 - "${active_record}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    record = json.load(input_file)
print(
    record.get("databaseReleaseId", ""),
    record.get("databaseLineageId") or "",
    record.get("runtimeGrantSha256", ""),
    record.get("databaseCompatibilitySha256", ""),
    record.get("runtimeInfrastructureCompatibilitySha256", ""),
    sep="|",
)
PY
	)
	IFS='|' read -r \
		active_database_sha active_lineage_id active_grant_sha \
		active_contract_sha active_runtime_contract_sha <<<"${state}"
	if [[ ! "${source_sha}" =~ ^[0-9a-f]{40}$ ]] ||
		[[ ! "${active_database_sha}" =~ ^[0-9a-f]{40}$ ]] ||
		[[ ! "${active_grant_sha}" =~ ^[0-9a-f]{64}$ ]] ||
		[[ ! "${active_contract_sha}" =~ ^[0-9a-f]{64}$ ]] ||
		[[ ! "${active_runtime_contract_sha}" =~ ^[0-9a-f]{64}$ ]]; then
		echo "Current release state is incomplete" >&2
		exit 1
	fi
	if [[ -n "${active_lineage_id}" &&
		! "${active_lineage_id}" =~ ^github-actions-[0-9]+$ ]]; then
		echo "Current database lineage evidence is invalid" >&2
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
		"${active_record}" "${source_sha}" "${active_database_sha}" \
		"${active_grant_sha}" "${active_contract_sha}" \
		"${active_runtime_contract_sha}" "${active_lineage_id}"
	if [[ -f "${reset_consumed_file}" ]]; then
		boundary_reset_id=$(python3 - "${reset_consumed_file}" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    audit = json.load(input_file)
reset_id = audit.get("resetId")
if (
    not isinstance(reset_id, str)
    or not re.fullmatch(r"github-actions-[0-9]+", reset_id)
):
    raise SystemExit("Crew staging reset lineage evidence is invalid")
print(reset_id)
PY
		)
		completion=$(reset_completed_path "${boundary_reset_id}")
		if [[ -f "${completion}" ]]; then
			validate_reset_completion "${completion}"
			[[ "${active_lineage_id}" == "${boundary_reset_id}" ]] || {
				echo "Current database lineage does not match the completed reset" >&2
				exit 1
			}
		fi
	fi
}

compatibility_proof_path() {
	printf '%s/%s-%s-%s.json\n' \
		"${compatibility_dir}" "$1" "$2" "$3"
}

validate_compatibility_proof() {
	local proof=$1 from_sha=$2 to_sha=$3 database_sha=$4 grant_sha=$5
	local database_contract_sha=$6 runtime_contract_sha=$7
	local database_lineage_id=${8:-}
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
	if [[ -n "${database_lineage_id}" ]]; then
		grep -Fq \
			"\"databaseLineageId\": \"${database_lineage_id}\"" "${proof}"
	fi
}

write_compatibility_proof() {
	local from_sha=$1 to_sha=$2 database_sha=$3 grant_sha=$4
	local database_contract_sha=$5 runtime_contract_sha=$6
	local proof temporary from_manifest_sha to_manifest_sha
	proof=$(compatibility_proof_path "${from_sha}" "${to_sha}" "${database_sha}")
	if [[ -f "${proof}" ]]; then
		validate_compatibility_proof \
			"${proof}" "${from_sha}" "${to_sha}" "${database_sha}" \
			"${grant_sha}" "${database_contract_sha}" "${runtime_contract_sha}" \
			"${database_lineage_id}"
		printf '%s\n' "${proof}"
		return
	fi
	from_manifest_sha=$(image_manifest_sha "${from_sha}")
	to_manifest_sha=$(image_manifest_sha "${to_sha}")
	temporary=$(mktemp "${compatibility_dir}/.proof.XXXXXX")
	python3 - \
		"${temporary}" "${from_sha}" "${to_sha}" "${database_sha}" \
		"${grant_sha}" "${database_contract_sha}" "${runtime_contract_sha}" \
		"${from_manifest_sha}" "${to_manifest_sha}" "${database_lineage_id}" <<'PY'
import json
import sys
from datetime import datetime, timezone

(
    output,
    from_release,
    to_release,
    database_release,
    grant_sha,
    database_contract_sha,
    runtime_contract_sha,
    from_manifest_sha,
    to_manifest_sha,
    database_lineage_id,
) = sys.argv[1:]
proof = {
    "schemaVersion": 2,
    "environment": "staging",
    "kind": "identical-database-and-runtime-contract",
    "fromReleaseId": from_release,
    "toReleaseId": to_release,
    "databaseReleaseId": database_release,
    "runtimeGrantSha256": grant_sha,
    "databaseCompatibilitySha256": database_contract_sha,
    "runtimeInfrastructureCompatibilitySha256": runtime_contract_sha,
    "fromImageManifestSha256": from_manifest_sha,
    "toImageManifestSha256": to_manifest_sha,
    "verifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
if database_lineage_id:
    proof["databaseLineageId"] = database_lineage_id
with open(output, "w", encoding="utf-8") as output_file:
    json.dump(proof, output_file, indent=2)
    output_file.write("\n")
PY
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
	local output=${1:-${digest_override_file}} temporary
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
	mv "${temporary}" "${output}"
	if [[ "${output}" == "${digest_override_file}" ]]; then
		image_distribution_override_sha=$(
			sha256sum "${digest_override_file}" | cut -d ' ' -f 1
		)
	fi
}

write_release_digest_override() {
	local release_sha=$1 output=$2 manifest canonical environment_output
	manifest="${manifests_dir}/${release_sha}.json"
	canonical=$(mktemp "${manifests_dir}/.canonical.XXXXXX")
	environment_output=$(mktemp "${manifests_dir}/.environment.XXXXXX")
	canonicalize_image_manifest \
		"${manifest}" "${canonical}" "${environment_output}" "${release_sha}" false
	(
		# Values are constrained by canonicalize_image_manifest.
		source "${environment_output}"
		write_digest_override "${output}"
	)
	rm -f "${canonical}" "${environment_output}"
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

compose_with_override() {
	local release_dir=$1 release_sha=$2 override=$3
	shift 3
	CREW_RELEASE_SHA="${release_sha}" \
		CREW_DEPLOY_ASSET_DIR="${release_dir}/infra/staging" \
		CREW_DEPLOY_SHARED_DIR="${shared_dir}" \
		docker compose \
		--project-name crew-next-staging \
		--project-directory "${release_dir}" \
		--env-file "${environment_file}" \
		--file "${release_dir}/compose.yaml" \
		--file "${release_dir}/infra/staging/compose.staging.yaml" \
		--file "${override}" \
		"$@"
}

compose_command() {
	local release_dir=$1
	shift
	compose_with_override \
		"${release_dir}" "${target_sha}" "${digest_override_file}" "$@"
}

reset_expected_volumes() {
	printf '%s\n' \
		crew-next-staging_minio_data \
		crew-next-staging_postgres_data \
		crew-next-staging_redis_rate_limit_data \
		crew-next-staging_typesense_data \
		crew-next-staging_user_jwt_keys |
		sort
}

reset_completed_path() {
	printf '%s/%s.completed.json\n' "${reset_records_dir}" "$1"
}

reset_deleted_path() {
	printf '%s/%s.deleted\n' "${reset_records_dir}" "$1"
}

validate_reset_audit() {
	[[ -f "${reset_consumed_file}" && ! -L "${reset_consumed_file}" ]] || {
		echo "Crew staging reset audit is unavailable" >&2
		exit 1
	}
	[[ $(stat -c '%U:%G:%a' "${reset_consumed_file}") == root:root:600 ]] || {
		echo "Crew staging reset audit ownership or mode is invalid" >&2
		exit 1
	}
	python3 - \
		"${reset_consumed_file}" "${reset_id}" "${reset_expected_current_sha}" \
		"${target_sha}" "${target_manifest_sha}" "${records_dir}" <<'PY'
import hashlib
import json
import os
import re
import sys

path, reset_id, from_release, to_release, manifest_sha, records_dir = sys.argv[1:]
with open(path, encoding="utf-8") as input_file:
    audit = json.load(input_file)
expected_volumes = [
    "crew-next-staging_minio_data",
    "crew-next-staging_postgres_data",
    "crew-next-staging_redis_rate_limit_data",
    "crew-next-staging_typesense_data",
    "crew-next-staging_user_jwt_keys",
]
expected = {
    "schemaVersion": 1,
    "environment": "crew-next-staging",
    "resetId": reset_id,
    "state": "consumed",
    "fromReleaseId": from_release,
    "toReleaseId": to_release,
    "imageManifestSha256": manifest_sha,
}
if any(audit.get(key) != value for key, value in expected.items()):
    raise SystemExit("Staging reset replay does not match the recorded intent")
if audit.get("deletedVolumes") != expected_volumes:
    raise SystemExit("Staging reset audit volume scope is invalid")
metadata = audit.get("volumeMetadata")
if (
    not isinstance(metadata, list)
    or [item.get("name") for item in metadata] != expected_volumes
    or any(not isinstance(item.get("createdAt"), str) or not item["createdAt"] for item in metadata)
):
    raise SystemExit("Staging reset audit volume identity is invalid")
for key in (
    "currentRecord",
    "currentRecordSha256",
    "databaseReleaseId",
    "runtimeGrantSha256",
    "databaseCompatibilitySha256",
    "runtimeInfrastructureCompatibilitySha256",
    "environmentSha256",
    "consumedAt",
):
    if not isinstance(audit.get(key), str) or not audit[key]:
        raise SystemExit(f"Staging reset audit field is invalid: {key}")
if not re.fullmatch(r"[0-9a-f]{64}", audit["currentRecordSha256"]):
    raise SystemExit("Staging reset audit record digest is invalid")
record_name = audit["currentRecord"]
if not isinstance(record_name, str) or os.path.basename(record_name) != record_name:
    raise SystemExit("Staging reset audit record path is invalid")
record_path = os.path.join(records_dir, record_name)
if not os.path.isfile(record_path) or os.path.islink(record_path):
    raise SystemExit("Staging reset source record is unavailable")
record_stat = os.stat(record_path)
if record_stat.st_uid != 0 or record_stat.st_gid != 0 or record_stat.st_mode & 0o777 != 0o600:
    raise SystemExit("Staging reset source record ownership or mode is invalid")
with open(record_path, "rb") as input_file:
    if hashlib.sha256(input_file.read()).hexdigest() != audit["currentRecordSha256"]:
        raise SystemExit("Staging reset source record digest changed")
PY
}

validate_reset_completion() {
	local completion=$1
	[[ -f "${completion}" && ! -L "${completion}" ]] || {
		echo "Crew staging reset completion evidence is unavailable" >&2
		exit 1
	}
	[[ $(stat -c '%U:%G:%a' "${completion}") == root:root:600 ]] || {
		echo "Crew staging reset completion ownership or mode is invalid" >&2
		exit 1
	}
	python3 - "${reset_consumed_file}" "${completion}" "${records_dir}" <<'PY'
import hashlib
import json
import os
import re
import sys

audit_path, completion_path, records_dir = sys.argv[1:]
with open(audit_path, "rb") as input_file:
    audit_bytes = input_file.read()
audit = json.loads(audit_bytes)
with open(completion_path, encoding="utf-8") as input_file:
    completion = json.load(input_file)
expected = {
    "schemaVersion": 1,
    "environment": "crew-next-staging",
    "resetId": audit["resetId"],
    "state": "completed",
    "fromReleaseId": audit["fromReleaseId"],
    "toReleaseId": audit["toReleaseId"],
    "resetAuditSha256": hashlib.sha256(audit_bytes).hexdigest(),
}
if any(completion.get(key) != value for key, value in expected.items()):
    raise SystemExit("Crew staging reset completion evidence is invalid")
record_name = completion.get("releaseRecord")
record_sha = completion.get("releaseRecordSha256")
if (
    not isinstance(record_name, str)
    or os.path.basename(record_name) != record_name
    or not isinstance(record_sha, str)
    or not re.fullmatch(r"[0-9a-f]{64}", record_sha)
):
    raise SystemExit("Crew staging reset completion record is invalid")
record_path = os.path.join(records_dir, record_name)
if not os.path.isfile(record_path) or os.path.islink(record_path):
    raise SystemExit("Crew staging reset release record is unavailable")
record_stat = os.stat(record_path)
if record_stat.st_uid != 0 or record_stat.st_gid != 0 or record_stat.st_mode & 0o777 != 0o600:
    raise SystemExit("Crew staging reset release record ownership or mode is invalid")
with open(record_path, "rb") as input_file:
    record_bytes = input_file.read()
if hashlib.sha256(record_bytes).hexdigest() != record_sha:
    raise SystemExit("Crew staging reset release record digest changed")
record = json.loads(record_bytes)
record_expected = {
    "schemaVersion": 2,
    "environment": "staging",
    "action": "reset-deploy",
    "fromReleaseId": audit["fromReleaseId"],
    "releaseId": audit["toReleaseId"],
    "databaseReleaseId": audit["toReleaseId"],
    "databaseLineageId": audit["resetId"],
    "dataReset": True,
    "resetId": audit["resetId"],
    "resetAuditSha256": expected["resetAuditSha256"],
    "imageManifestSha256": audit["imageManifestSha256"],
}
if any(record.get(key) != value for key, value in record_expected.items()):
    raise SystemExit("Crew staging reset release record content is invalid")
PY
}

write_reset_marker() {
	local temporary
	if [[ -e "${reset_in_progress_file}" ]]; then
		[[ -f "${reset_in_progress_file}" && ! -L "${reset_in_progress_file}" ]] || {
			echo "Crew staging reset marker is invalid" >&2
			exit 1
		}
		[[ $(stat -c '%U:%G:%a' "${reset_in_progress_file}") == root:root:600 ]] || {
			echo "Crew staging reset marker ownership or mode is invalid" >&2
			exit 1
		}
		[[ $(cat "${reset_in_progress_file}") == "${reset_id}" ]] || {
			echo "Another staging reset is already in progress" >&2
			exit 1
		}
		return
	fi
	temporary=$(mktemp "${shared_dir}/.reset-in-progress.XXXXXX")
	printf '%s\n' "${reset_id}" >"${temporary}"
	chmod 0600 "${temporary}"
	sync -f "${temporary}"
	mv "${temporary}" "${reset_in_progress_file}"
	sync -f "${reset_in_progress_file}"
}

write_reset_audit() {
	local current_record current_record_sha environment_sha temporary volume_metadata
	[[ ! -e "${reset_consumed_file}" && ! -L "${reset_consumed_file}" ]] || {
		echo "Crew staging greenfield reset was already consumed" >&2
		exit 1
	}
	current_record=${active_record}
	current_record_sha=$(sha256sum "${current_record}" | cut -d ' ' -f 1)
	environment_sha=$(sha256sum "${environment_file}" | cut -d ' ' -f 1)
	temporary=$(mktemp "${reset_records_dir}/.greenfield-reset.XXXXXX")
	volume_metadata=$(mktemp "${reset_records_dir}/.volume-metadata.XXXXXX")
	for volume in $(reset_expected_volumes); do
		docker volume inspect "${volume}" \
			--format '{{.Name}}	{{.CreatedAt}}' >>"${volume_metadata}"
	done
	python3 - \
		"${temporary}" "${reset_id}" "${reset_expected_current_sha}" "${target_sha}" \
		"${target_manifest_sha}" "$(basename "${current_record}")" \
		"${current_record_sha}" "${active_database_sha}" "${active_grant_sha}" \
		"${active_contract_sha}" "${active_runtime_contract_sha}" \
		"${environment_sha}" "${volume_metadata}" <<'PY'
import json
import sys
from datetime import datetime, timezone

(
    output,
    reset_id,
    from_release,
    to_release,
    manifest_sha,
    current_record,
    current_record_sha,
    database_release,
    grant_sha,
    database_contract_sha,
    runtime_contract_sha,
    environment_sha,
    volume_metadata_path,
) = sys.argv[1:]
with open(volume_metadata_path, encoding="utf-8") as input_file:
    volume_metadata = [
        {"name": line.rstrip("\n").split("\t", 1)[0], "createdAt": line.rstrip("\n").split("\t", 1)[1]}
        for line in input_file
    ]
audit = {
    "schemaVersion": 1,
    "environment": "crew-next-staging",
    "resetId": reset_id,
    "state": "consumed",
    "fromReleaseId": from_release,
    "toReleaseId": to_release,
    "imageManifestSha256": manifest_sha,
    "currentRecord": current_record,
    "currentRecordSha256": current_record_sha,
    "databaseReleaseId": database_release,
    "runtimeGrantSha256": grant_sha,
    "databaseCompatibilitySha256": database_contract_sha,
    "runtimeInfrastructureCompatibilitySha256": runtime_contract_sha,
    "environmentSha256": environment_sha,
    "deletedVolumes": sorted(item["name"] for item in volume_metadata),
    "volumeMetadata": volume_metadata,
    "preservedPaths": ["environment", "tls", "records", "manifests", "releases"],
    "authorization": "crew-next-staging GitHub Environment",
    "consumedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(output, "w", encoding="utf-8") as output_file:
    json.dump(audit, output_file, indent=2)
    output_file.write("\n")
PY
	rm -f "${volume_metadata}"
	chmod 0600 "${temporary}"
	sync -f "${temporary}"
	mv "${temporary}" "${reset_consumed_file}"
	sync -f "${reset_consumed_file}"
}

verify_reset_environment() {
	local expected actual
	expected=$(python3 - "${reset_consumed_file}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    print(json.load(input_file)["environmentSha256"])
PY
	)
	actual=$(sha256sum "${environment_file}" | cut -d ' ' -f 1)
	[[ "${actual}" == "${expected}" ]] || {
		echo "Crew staging environment changed during the data reset" >&2
		exit 1
	}
}

reset_volume_metadata() {
	python3 - "${reset_consumed_file}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    audit = json.load(input_file)
for item in audit["volumeMetadata"]:
    print(f"{item['name']}\t{item['createdAt']}")
PY
}

verify_reset_source_volumes() {
	local expected_metadata volume expected_created actual_created
	expected_metadata=$(reset_volume_metadata)
	while IFS=$'\t' read -r volume expected_created; do
		docker volume inspect "${volume}" >/dev/null 2>&1 || continue
		actual_created=$(docker volume inspect "${volume}" --format '{{.CreatedAt}}')
		[[ "${actual_created}" == "${expected_created}" ]] || {
			echo "Crew staging reset source volume identity changed for ${volume}" >&2
			exit 1
		}
	done <<<"${expected_metadata}"
}

load_reset_resume_intent() {
	local requested_id=${CREW_RESET_RESUME_ID:-} identity
	[[ -n "${requested_id}" ]] || return 0
	[[ "${reset_staging_data}" == false &&
		"${requested_id}" =~ ^github-actions-[0-9]+$ ]] || {
		echo "Crew staging reset resume request is invalid" >&2
		exit 1
	}
	[[ -f "${reset_consumed_file}" && ! -L "${reset_consumed_file}" &&
		$(stat -c '%U:%G:%a' "${reset_consumed_file}") == root:root:600 ]] || {
		echo "Crew staging reset resume audit is unavailable" >&2
		exit 1
	}
	identity=$(python3 - \
		"${reset_consumed_file}" "${requested_id}" "${target_sha}" \
		"${target_manifest_sha}" <<'PY'
import json
import re
import sys

audit_path, reset_id, target_sha, manifest_sha = sys.argv[1:]
with open(audit_path, encoding="utf-8") as input_file:
    audit = json.load(input_file)
from_release = audit.get("fromReleaseId")
expected = {
    "schemaVersion": 1,
    "environment": "crew-next-staging",
    "resetId": reset_id,
    "state": "consumed",
    "toReleaseId": target_sha,
    "imageManifestSha256": manifest_sha,
}
if (
    any(audit.get(key) != value for key, value in expected.items())
    or not isinstance(from_release, str)
    or not re.fullmatch(r"[0-9a-f]{40}", from_release)
):
    raise SystemExit("Crew staging reset resume does not match the consumed intent")
print(from_release)
PY
	)
	reset_staging_data=true
	reset_id=${requested_id}
	reset_expected_current_sha=${identity}
}

reset_guard_normal_release() {
	local identity reset_id_from_audit completion
	[[ "${reset_staging_data}" != true ]] || return 0
	if [[ ! -e "${reset_consumed_file}" && ! -L "${reset_consumed_file}" ]]; then
		[[ ! -e "${reset_in_progress_file}" ]] || {
			echo "Crew staging reset marker has no audit record" >&2
			exit 1
		}
		return
	fi
	[[ -f "${reset_consumed_file}" && ! -L "${reset_consumed_file}" ]] || {
		echo "Crew staging reset audit is invalid" >&2
		exit 1
	}
	[[ $(stat -c '%U:%G:%a' "${reset_consumed_file}") == root:root:600 ]] || {
		echo "Crew staging reset audit ownership or mode is invalid" >&2
		exit 1
	}
	identity=$(python3 - "${reset_consumed_file}" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    audit = json.load(input_file)
reset_id = audit.get("resetId")
if (
    audit.get("schemaVersion") != 1
    or audit.get("environment") != "crew-next-staging"
    or audit.get("state") != "consumed"
    or not isinstance(reset_id, str)
    or not re.fullmatch(r"github-actions-[0-9]+", reset_id)
):
    raise SystemExit("Crew staging reset audit is invalid")
print(reset_id)
PY
	)
	reset_id_from_audit=${identity}
	completion=$(reset_completed_path "${reset_id_from_audit}")
	if [[ -e "${reset_in_progress_file}" || ! -f "${completion}" ]]; then
		echo "Crew staging reset is incomplete; only the identical reset intent may resume" >&2
		exit 1
	fi
	validate_reset_completion "${completion}"
}

validate_reset_resources() {
	local release_dir=$1 phase=$2 release_sha=$3 override=$4
	local actual_volumes expected_volumes actual_networks allowed_services
	local container container_ids attached label details logical service volume
	allowed_services=$(
		compose_with_override \
			"${release_dir}" "${release_sha}" "${override}" \
			--profile '*' config --services |
			sort
	)
	expected_volumes=$(reset_expected_volumes)
	actual_volumes=$(
		docker volume ls --format '{{.Name}}' \
			--filter label=com.docker.compose.project=crew-next-staging |
			sort
	)
	while IFS= read -r volume; do
		case "${volume}" in
			"" | crew-next-staging_minio_data | crew-next-staging_postgres_data | \
				crew-next-staging_redis_rate_limit_data | \
				crew-next-staging_typesense_data | \
				crew-next-staging_user_jwt_keys) ;;
			*)
				echo "Crew staging reset found an unexpected project volume" >&2
				exit 1
				;;
		esac
	done <<<"${actual_volumes}"
	if [[ "${phase}" == new && "${actual_volumes}" != "${expected_volumes}" ]]; then
		echo "Crew staging reset volume state is neither intact nor deleted" >&2
		exit 1
	fi
	actual_networks=$(
		docker network ls --format '{{.Name}}' \
			--filter label=com.docker.compose.project=crew-next-staging |
			sort
	)
	if [[ "${actual_networks}" != crew-next-staging_default &&
		-n "${actual_networks}" ]]; then
		echo "Crew staging reset network scope is not exact" >&2
		exit 1
	fi
	if [[ "${phase}" == new && "${actual_networks}" != crew-next-staging_default ]]; then
		echo "Crew staging reset network is unavailable" >&2
		exit 1
	fi
	if [[ -n "${actual_networks}" ]]; then
		details=$(docker network inspect crew-next-staging_default --format \
			'{{.Driver}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}')
		[[ "${details}" == "bridge|crew-next-staging|default" ]] || {
			echo "Crew staging reset network labels are invalid" >&2
			exit 1
		}
	fi
	for volume in $(reset_expected_volumes); do
		docker volume inspect "${volume}" >/dev/null 2>&1 || continue
		logical=${volume#crew-next-staging_}
		details=$(docker volume inspect "${volume}" --format \
			'{{.Driver}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}')
		[[ "${details}" == "local|crew-next-staging|${logical}" ]] || {
			echo "Crew staging reset volume labels are invalid for ${volume}" >&2
			exit 1
		}
		attached=$(docker container ls --all --quiet --filter volume="${volume}")
		for container in ${attached}; do
			label=$(docker container inspect "${container}" --format \
				'{{index .Config.Labels "com.docker.compose.project"}}')
			[[ "${label}" == crew-next-staging ]] || {
				echo "Crew staging reset volume is attached to a foreign container" >&2
				exit 1
			}
		done
	done
	container_ids=$(docker container ls --all --quiet \
		--filter label=com.docker.compose.project=crew-next-staging)
	for container in ${container_ids}; do
		label=$(docker container inspect "${container}" --format \
			'{{index .Config.Labels "com.docker.compose.project"}}')
		[[ "${label}" == crew-next-staging ]] || {
			echo "Crew staging reset container scope is invalid" >&2
			exit 1
		}
		service=$(docker container inspect "${container}" --format \
			'{{index .Config.Labels "com.docker.compose.service"}}')
		grep -Fxq "${service}" <<<"${allowed_services}" || {
			echo "Crew staging reset found an unexpected project service" >&2
			exit 1
		}
	done
	if [[ -n "${actual_networks}" ]]; then
		attached=$(docker network inspect crew-next-staging_default \
			--format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}')
		for container in ${attached}; do
			label=$(docker container inspect "${container}" --format \
				'{{index .Config.Labels "com.docker.compose.project"}}')
			[[ "${label}" == crew-next-staging ]] || {
				echo "Crew staging reset network has a foreign container" >&2
				exit 1
			}
		done
	fi
	if [[ "${phase}" == new ]]; then
		[[ -L "${deploy_root}/current" ]] &&
			[[ $(readlink -f "${deploy_root}/current") == "$(readlink -f "${release_dir}")" ]] || {
			echo "Crew staging current symlink does not match the active release" >&2
			exit 1
		}
	fi
}

reset_greenfield_staging() {
	local release_dir=$1 release_sha=$2 override=$3 phase=$4
	local remaining_containers remaining_volumes remaining_networks deleted
	local volume logical details expected_metadata expected_created metadata_volume
	validate_reset_resources \
		"${release_dir}" "${phase}" "${release_sha}" "${override}"
	if [[ "${phase}" == consumed ]]; then
		expected_metadata=$(reset_volume_metadata)
	fi
	compose_with_override \
		"${release_dir}" "${release_sha}" "${override}" \
		--profile '*' down --remove-orphans
	for volume in $(reset_expected_volumes); do
		if docker volume inspect "${volume}" >/dev/null 2>&1; then
			logical=${volume#crew-next-staging_}
			details=$(docker volume inspect "${volume}" --format \
				'{{.CreatedAt}}|{{.Driver}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}')
			if [[ "${phase}" == consumed ]]; then
				expected_created=
				while IFS=$'\t' read -r metadata_volume expected_created; do
					[[ "${metadata_volume}" == "${volume}" ]] && break
					expected_created=
				done <<<"${expected_metadata}"
				[[ -n "${expected_created}" &&
					"${details}" == "${expected_created}|local|crew-next-staging|${logical}" ]] || {
					echo "Crew staging reset volume identity changed before deletion" >&2
					exit 1
				}
			else
				[[ -n "${details%%|*}" &&
					"${details}" == *"|local|crew-next-staging|${logical}" ]] || {
					echo "Crew staging reset partial target volume is invalid" >&2
					exit 1
				}
			fi
			docker volume rm -- "${volume}"
		fi
	done
	remaining_containers=$(docker container ls --all --quiet \
		--filter label=com.docker.compose.project=crew-next-staging)
	remaining_volumes=$(docker volume ls --quiet \
		--filter label=com.docker.compose.project=crew-next-staging)
	remaining_networks=$(docker network ls --quiet \
		--filter label=com.docker.compose.project=crew-next-staging)
	if [[ -n "${remaining_containers}" || -n "${remaining_volumes}" ||
		-n "${remaining_networks}" ]]; then
		echo "Crew staging reset left project resources behind" >&2
		exit 1
	fi
	for volume in $(reset_expected_volumes); do
		! docker volume inspect "${volume}" >/dev/null 2>&1 || {
			echo "Crew staging reset left ${volume} behind" >&2
			exit 1
		}
	done
	rm -f -- \
		"${current_file}" "${previous_file}" "${database_file}" \
		"${database_lineage_file}" "${grant_file}" "${database_contract_file}" \
		"${runtime_contract_file}" "${current_record_file}" "${deploy_root}/current"
	deleted=$(reset_deleted_path "${reset_id}")
	if [[ ! -f "${deleted}" ]]; then
		local temporary
		temporary=$(mktemp "${reset_records_dir}/.reset-deleted.XXXXXX")
		printf '%s\n' "${reset_id}" >"${temporary}"
		chmod 0600 "${temporary}"
		sync -f "${temporary}"
		mv "${temporary}" "${deleted}"
		sync -f "${deleted}"
	fi
}

complete_greenfield_reset() {
	local release_record=$1 completion temporary audit_sha release_record_sha
	completion=$(reset_completed_path "${reset_id}")
	audit_sha=$(sha256sum "${reset_consumed_file}" | cut -d ' ' -f 1)
	if [[ ! -f "${completion}" ]]; then
		release_record_sha=$(sha256sum "${release_record}" | cut -d ' ' -f 1)
		temporary=$(mktemp "${reset_records_dir}/.reset-completed.XXXXXX")
		python3 - \
			"${temporary}" "${reset_id}" "${reset_expected_current_sha}" \
			"${target_sha}" "${audit_sha}" "$(basename "${release_record}")" \
			"${release_record_sha}" <<'PY'
import json
import sys
from datetime import datetime, timezone

(
    output,
    reset_id,
    from_release,
    to_release,
    audit_sha,
    release_record,
    release_record_sha,
) = sys.argv[1:]
completion = {
    "schemaVersion": 1,
    "environment": "crew-next-staging",
    "resetId": reset_id,
    "state": "completed",
    "fromReleaseId": from_release,
    "toReleaseId": to_release,
    "resetAuditSha256": audit_sha,
    "releaseRecord": release_record,
    "releaseRecordSha256": release_record_sha,
    "completedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
with open(output, "w", encoding="utf-8") as output_file:
    json.dump(completion, output_file, indent=2)
    output_file.write("\n")
PY
		chmod 0600 "${temporary}"
		sync -f "${temporary}"
		mv "${temporary}" "${completion}"
		sync -f "${completion}"
	fi
	validate_reset_completion "${completion}"
	rm -f -- "${reset_in_progress_file}"
}

enforce_reset_rollback_boundary() {
	local boundary audit_reset_id
	[[ -f "${reset_consumed_file}" ]] || return 0
	boundary=$(python3 - "${reset_consumed_file}" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    audit = json.load(input_file)
boundary = audit.get("toReleaseId")
if not isinstance(boundary, str) or not re.fullmatch(r"[0-9a-f]{40}", boundary):
    raise SystemExit("Crew staging reset boundary is invalid")
print(boundary)
PY
	)
	audit_reset_id=$(python3 - "${reset_consumed_file}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as input_file:
    print(json.load(input_file)["resetId"])
PY
	)
	validate_reset_completion "$(reset_completed_path "${audit_reset_id}")"
	git -C "${release_dir}" merge-base --is-ancestor "${boundary}" "${target_sha}" || {
		echo "Rollback cannot cross a staging reset boundary" >&2
		exit 1
	}
}

prepare_greenfield_reset() {
	local current_source=$1 completion deleted phase source_override source_release_dir
	local current_record
	[[ "${reset_expected_current_sha}" != "${target_sha}" ]] || {
		echo "Staging reset requires a different target release" >&2
		exit 1
	}
	completion=$(reset_completed_path "${reset_id}")
	deleted=$(reset_deleted_path "${reset_id}")
	if [[ -e "${reset_consumed_file}" ]]; then
		validate_reset_audit
		if [[ -f "${completion}" ]]; then
			[[ "${current_source}" == "${target_sha}" ]] || {
				echo "Completed staging reset conflicts with the active release" >&2
				exit 1
			}
			validate_current_state "${target_sha}"
			current_record=${active_record}
			complete_greenfield_reset "${current_record}"
			compose_command "${release_dir}" ps
			exit 0
		fi
		write_reset_marker
	else
		[[ "${current_source}" == "${reset_expected_current_sha}" ]] || {
			echo "Staging reset expected current release does not match active staging" >&2
			exit 1
		}
		validate_current_state "${current_source}"
		source_release_dir="${releases_dir}/${current_source}"
		source_override=$(mktemp "${shared_dir}/.source-compose-digest.XXXXXX")
		write_release_digest_override "${current_source}" "${source_override}"
		validate_reset_resources \
			"${source_release_dir}" new "${current_source}" "${source_override}"
		write_reset_audit
		write_reset_marker
	fi
	verify_reset_environment

	if [[ "${current_source}" == "${target_sha}" ]]; then
		validate_current_state "${target_sha}"
		current_record=${active_record}
		complete_greenfield_reset "${current_record}"
		compose_command "${release_dir}" ps
		exit 0
	fi
	if [[ -n "${current_source}" &&
		"${current_source}" != "${reset_expected_current_sha}" ]]; then
		echo "Staging reset replay does not match the active release" >&2
		exit 1
	fi
	if [[ -n "${current_source}" ]]; then
		validate_current_state "${current_source}"
	fi

	if [[ -f "${deleted}" ]]; then
		[[ ! -L "${deleted}" &&
			$(stat -c '%U:%G:%a' "${deleted}") == root:root:600 &&
			$(cat "${deleted}") == "${reset_id}" ]] || {
			echo "Crew staging reset deleted marker is invalid" >&2
			exit 1
		}
		[[ -z "${current_source}" ]] || {
			echo "Crew staging reset deleted marker conflicts with active state" >&2
			exit 1
		}
		phase=deleted
		reset_greenfield_staging \
			"${release_dir}" "${target_sha}" "${digest_override_file}" "${phase}"
	else
		phase=consumed
		verify_reset_source_volumes
		source_release_dir="${releases_dir}/${reset_expected_current_sha}"
		[[ -d "${source_release_dir}/.git" ]] || {
			echo "Staging reset source release is unavailable" >&2
			exit 1
		}
		if [[ -z "${source_override:-}" ]]; then
			source_override=$(mktemp "${shared_dir}/.source-compose-digest.XXXXXX")
			write_release_digest_override \
				"${reset_expected_current_sha}" "${source_override}"
		fi
		reset_greenfield_staging \
			"${source_release_dir}" "${reset_expected_current_sha}" \
			"${source_override}" "${phase}"
		rm -f "${source_override}"
	fi
	verify_reset_environment
}

run_job() {
	local release_dir=$1
	local service=$2
	compose_command "${release_dir}" up \
		--no-build --no-deps --force-recreate --abort-on-container-exit \
		--exit-code-from "${service}" "${service}"
}

run_place_import() {
	local release_dir=$1
	local import_status
	if run_job "${release_dir}" place-golf-import; then
		return 0
	else
		import_status=$?
	fi
	if [[ "${import_status}" -eq 75 ]]; then
		echo "Primary Overpass unavailable; retrying the official failover" >&2
		if compose_command "${release_dir}" run --rm --no-deps \
			-e PLACE_GOLF_IMPORT_OVERPASS_URL=https://z.overpass-api.de/api/interpreter \
			place-golf-import; then
			return 0
		else
			import_status=$?
		fi
	fi
	return "${import_status}"
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
	local search_key search_response
	search_key=$(environment_value TYPESENSE_SEARCH_API_KEY)
	search_response=$(curl --fail --silent --show-error \
		--max-time 10 \
		--header "X-TYPESENSE-API-KEY: ${search_key}" \
		"http://127.0.0.1:8108/collections/crew_places/documents/search?q=%2A&query_by=name&per_page=1")
	if ! python3 -c \
		'import json,sys; raise SystemExit(json.load(sys.stdin).get("found", 0) < 1)' \
		<<<"${search_response}"; then
		echo "Typesense Crew place index is empty or invalid" >&2
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
	local internal_tls_reference proof_json record data_reset
	local lineage_json reset_id_json reset_audit_json
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
	data_reset=false
	lineage_json=null
	reset_id_json=null
	reset_audit_json=null
	if [[ -n "${compatibility_proof}" ]]; then
		proof_json="\"$(basename "${compatibility_proof}")\""
	fi
	if [[ -n "${database_lineage_id}" ]]; then
		lineage_json="\"${database_lineage_id}\""
	fi
	if [[ "${release_action}" == reset-deploy ]]; then
		data_reset=true
		reset_id_json="\"${reset_id}\""
		reset_audit_sha=$(sha256sum "${reset_consumed_file}" | cut -d ' ' -f 1)
		reset_audit_json="\"${reset_audit_sha}\""
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
		"  \"databaseLineageId\": ${lineage_json}," \
		"  \"recordedAt\": \"${recorded_at}\"," \
		'  "publicGatewayOrigin": "https://staging.crew-haus.com",' \
		'  "mobileGatewayBaseUrl": "https://staging.crew-haus.com",' \
		'  "features": {"placeEnrichment": "disabled-no-provider-worker"},' \
		"  \"runtimeGrantSha256\": \"${grant_sha}\"," \
		"  \"databaseCompatibilitySha256\": \"${contract_sha}\"," \
		"  \"runtimeInfrastructureCompatibilitySha256\": \"${runtime_contract_sha}\"," \
		"  \"imageManifestSha256\": \"${target_manifest_sha}\"," \
		"  \"imageDistributionOverrideSha256\": \"${image_distribution_override_sha}\"," \
		"  \"dataReset\": ${data_reset}," \
		"  \"resetId\": ${reset_id_json}," \
		"  \"resetAuditSha256\": ${reset_audit_json}," \
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
	local record_pointer="${records_dir}/active-${release_sha}.record"
	local temporary pointer_temporary
	pointer_temporary=$(mktemp "${records_dir}/.active-record.XXXXXX")
	printf '%s\n' "${record}" >"${pointer_temporary}"
	chmod 0600 "${pointer_temporary}"
	sync -f "${pointer_temporary}"
	mv "${pointer_temporary}" "${record_pointer}" || return 1
	sync -f "${record_pointer}"
	printf '%s\n' "${database_sha}" >"${database_file}"
	if [[ -n "${database_lineage_id}" ]]; then
		printf '%s\n' "${database_lineage_id}" >"${database_lineage_file}"
	else
		rm -f -- "${database_lineage_file}"
	fi
	runtime_grant_sha "${database_release_dir}" >"${grant_file}"
	database_contract_sha "${database_release_dir}" >"${database_contract_file}"
	runtime_infrastructure_contract_sha "${release_dir}" >"${runtime_contract_file}"
	ln -sfn "${releases_dir}/${release_sha}" "${deploy_root}/current"
	temporary=$(mktemp "${shared_dir}/.current-release.XXXXXX")
	printf '%s\n' "${release_sha}" >"${temporary}"
	chmod 0600 "${temporary}"
	sync -f "${shared_dir}"
	mv "${temporary}" "${current_file}" || return 1
	sync -f "${current_file}"
	temporary=$(mktemp "${shared_dir}/.current-record.XXXXXX")
	printf '%s\n' "${record}" >"${temporary}"
	chmod 0600 "${temporary}"
	mv "${temporary}" "${current_record_file}"
	sync -f "${current_record_file}"
}

ensure_environment
release_dir=$(checkout_release)
chmod -R a=rX -- "${release_dir}"
load_target_image_manifest
load_reset_resume_intent
reset_guard_normal_release
pull_release_images
write_digest_override
compose_command "${release_dir}" config --quiet
source_sha=$(cat "${current_file}" 2>/dev/null || true)
active_database_sha=
active_lineage_id=
active_grant_sha=
active_contract_sha=
active_runtime_contract_sha=
active_record=
compatibility_proof=
reset_from_sha=
release_action=deploy
database_lineage_id=
target_contract_sha=$(database_contract_sha "${release_dir}")
target_grant_sha=$(runtime_grant_sha "${release_dir}")
target_runtime_contract_sha=$(runtime_infrastructure_contract_sha "${release_dir}")

if [[ "${action}" == deploy ]]; then
	if [[ "${reset_staging_data}" == true ]]; then
		prepare_greenfield_reset "${source_sha}"
		reset_from_sha=${reset_expected_current_sha}
		release_action=reset-deploy
		database_lineage_id=${reset_id}
		source_sha=
	elif [[ -n "${source_sha}" ]]; then
		validate_current_state "${source_sha}"
		database_lineage_id=${active_lineage_id}
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
		-e "${database_lineage_file}" || -e "${current_record_file}" ]]; then
		echo "Greenfield bootstrap state is inconsistent" >&2
		exit 1
	fi
else
	if [[ -z "${source_sha}" || "${source_sha}" == "${target_sha}" ]]; then
		echo "Rollback requires a different currently deployed release" >&2
		exit 1
	fi
	validate_current_state "${source_sha}"
	database_lineage_id=${active_lineage_id}
	enforce_reset_rollback_boundary
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
		"${active_runtime_contract_sha}" "${active_lineage_id}"
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
	if run_place_import "${release_dir}"; then
		:
	else
		import_status=$?
		[[ "${import_status}" -eq 75 && -n "${source_sha}" ]] || {
			echo "Initial Crew place import failed" >&2
			exit "${import_status}"
		}
		echo "Crew place source unavailable; retaining the verified existing catalog" >&2
	fi
	run_job "${release_dir}" place-search-reindex
	verify_typesense_search_key
	smoke "${release_dir}"
	verify_service_image_references "${release_dir}"
	if [[ -n "${source_sha}" && "${source_sha}" != "${target_sha}" ]]; then
		printf '%s\n' "${source_sha}" >"${previous_file}"
	fi
	release_record=$(record_release \
		"${release_action}" "${reset_from_sha:-${source_sha}}" "${target_sha}" \
		"${compatibility_proof}")
	activate_release_state "${target_sha}" "${target_sha}" "${release_record}"
	if [[ "${release_action}" == reset-deploy ]]; then
		complete_greenfield_reset "${release_record}"
	fi
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
