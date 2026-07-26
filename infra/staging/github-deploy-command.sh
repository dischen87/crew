#!/usr/bin/env bash
set -Eeuo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOME=/root
GIT_TERMINAL_PROMPT=0
export PATH HOME GIT_TERMINAL_PROMPT

repository=https://github.com/dischen87/crew.git
deploy_root=/opt/crew-new
shared_dir="${deploy_root}/shared"
repository_dir="${shared_dir}/repository.git"
manifest_dir="${shared_dir}/manifests"
original_command=${SSH_ORIGINAL_COMMAND:-}

if ((${#original_command} > 16384)); then
	echo "Crew deploy command is too large" >&2
	exit 2
fi

action=
target_sha=
manifest_base64=
reset_resume_id=
if [[ "${original_command}" =~ ^deploy\ ([0-9a-f]{40})\ ([A-Za-z0-9+/]+={0,2})$ ]]; then
	action=deploy
	target_sha=${BASH_REMATCH[1]}
	manifest_base64=${BASH_REMATCH[2]}
elif [[ "${original_command}" =~ ^rollback\ ([0-9a-f]{40})$ ]]; then
	action=rollback
	target_sha=${BASH_REMATCH[1]}
elif [[ "${original_command}" =~ ^redeploy\ ([0-9a-f]{40})$ ]]; then
	action=redeploy
	target_sha=${BASH_REMATCH[1]}
elif [[ "${original_command}" =~ ^resume-reset\ ([0-9a-f]{40})\ (github-actions-[0-9]+)$ ]]; then
	action=resume-reset
	target_sha=${BASH_REMATCH[1]}
	reset_resume_id=${BASH_REMATCH[2]}
else
	echo "Crew deploy command is not permitted" >&2
	exit 2
fi

umask 077
mkdir -p "${shared_dir}" "${manifest_dir}"
exec 8>"${shared_dir}/github-deploy.lock"
flock -n 8 || {
	echo "Another Crew GitHub deployment is running" >&2
	exit 1
}

temporary=$(mktemp -d "${shared_dir}/.github-deploy.XXXXXX")
trap 'rm -rf -- "${temporary}"' EXIT
if [[ ! -d "${repository_dir}" ]]; then
	git clone --bare --filter=blob:none --single-branch --branch main \
		"${repository}" "${temporary}/repository.git" >/dev/null
	mv "${temporary}/repository.git" "${repository_dir}"
fi
[[ $(git --git-dir="${repository_dir}" remote get-url origin) == "${repository}" ]] ||
	{
		echo "Crew controller repository remote is invalid" >&2
		exit 1
	}
git --git-dir="${repository_dir}" fetch --quiet --prune --force \
	--filter=blob:none origin +refs/heads/main:refs/heads/main
controller_sha=$(git --git-dir="${repository_dir}" rev-parse refs/heads/main)

if [[ "${action}" == deploy ]]; then
	[[ "${target_sha}" == "${controller_sha}" ]] || {
		echo "Deploy target must be the current main revision" >&2
		exit 1
	}
	manifest_source="${temporary}/image-manifest.json"
	printf '%s' "${manifest_base64}" | base64 --decode >"${manifest_source}"
	[[ -s "${manifest_source}" ]] || {
		echo "Crew image manifest is empty" >&2
		exit 1
	}
else
	if [[ "${action}" == redeploy ]]; then
		[[ "${target_sha}" == "${controller_sha}" ]] || {
			echo "Redeploy target must be the current main revision" >&2
			exit 1
		}
	elif [[ "${action}" == rollback ]]; then
		git --git-dir="${repository_dir}" merge-base --is-ancestor \
			"${target_sha}" "${controller_sha}" || {
			echo "Rollback target must be an ancestor of current main" >&2
			exit 1
		}
	else
		git --git-dir="${repository_dir}" merge-base --is-ancestor \
			"${target_sha}" "${controller_sha}" || {
			echo "Reset resume target must be an ancestor of current main" >&2
			exit 1
		}
	fi
	stored_manifest="${manifest_dir}/${target_sha}.json"
	[[ -f "${stored_manifest}" && ! -L "${stored_manifest}" ]] ||
		{
			echo "Rollback image manifest is unavailable" >&2
			exit 1
		}
	[[ $(stat -c '%U:%G:%a' "${stored_manifest}") == root:root:600 ]] || {
		echo "Rollback image manifest ownership or mode is invalid" >&2
		exit 1
	}
	manifest_source=
fi

controller_entry=$(git --git-dir="${repository_dir}" ls-tree \
	"${controller_sha}" -- infra/staging/host-release.sh)
[[ "${controller_entry}" =~ ^100755\ blob\ [0-9a-f]{40}$'\t'infra/staging/host-release.sh$ ]] ||
	{
		echo "Crew host controller tree entry is invalid" >&2
		exit 1
	}
controller="${temporary}/host-release.sh"
git --git-dir="${repository_dir}" show \
	"${controller_sha}:infra/staging/host-release.sh" >"${controller}"
chmod 0700 "${controller}"
bash -n "${controller}"

if [[ "${action}" == deploy ]]; then
	env -i \
		PATH="${PATH}" HOME="${HOME}" GIT_TERMINAL_PROMPT=0 \
		CREW_DEPLOY_ROOT="${deploy_root}" \
		CREW_IMAGE_MANIFEST_SOURCE="${manifest_source}" \
		bash "${controller}" deploy "${target_sha}"
elif [[ "${action}" == redeploy ]]; then
	env -i \
		PATH="${PATH}" HOME="${HOME}" GIT_TERMINAL_PROMPT=0 \
		CREW_DEPLOY_ROOT="${deploy_root}" \
		bash "${controller}" deploy "${target_sha}"
elif [[ "${action}" == resume-reset ]]; then
	env -i \
		PATH="${PATH}" HOME="${HOME}" GIT_TERMINAL_PROMPT=0 \
		CREW_DEPLOY_ROOT="${deploy_root}" \
		CREW_RESET_RESUME_ID="${reset_resume_id}" \
		bash "${controller}" deploy "${target_sha}"
else
	env -i \
		PATH="${PATH}" HOME="${HOME}" GIT_TERMINAL_PROMPT=0 \
		CREW_DEPLOY_ROOT="${deploy_root}" \
		bash "${controller}" rollback "${target_sha}"
fi
