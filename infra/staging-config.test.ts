import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const composeSource = await Bun.file(new URL("compose.yaml", root)).text();
const overlaySource = await Bun.file(
	new URL("infra/staging/compose.staging.yaml", root),
).text();
const overlay = Bun.YAML.parse(overlaySource) as {
	name?: unknown;
	services?: Record<string, Record<string, unknown>>;
	networks?: Record<string, Record<string, unknown>>;
};
const services = overlay.services ?? {};
const hostDeploy = await Bun.file(
	new URL("infra/staging/host-release.sh", root),
).text();
const githubDeploy = await Bun.file(
	new URL("infra/staging/github-deploy-command.sh", root),
).text();
const releaseWorkflow = await Bun.file(
	new URL(".github/workflows/crew-staging-release.yml", root),
).text();
const haproxy = await Bun.file(
	new URL("infra/staging/haproxy.cfg", root),
).text();
const caddy = await Bun.file(new URL("infra/staging/Caddyfile", root)).text();
const webDockerfile = await Bun.file(
	new URL("apps/web/Dockerfile", root),
).text();
const appleAssociation = await Bun.file(
	new URL("apps/web/public/.well-known/apple-app-site-association", root),
).json();
const androidAssociationExists = await Bun.file(
	new URL("apps/web/public/.well-known/assetlinks.json", root),
).exists();

const nativeSpawn = `
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const result = spawnSync(process.argv[1], process.argv.slice(2), {
	input: fs.readFileSync(0),
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
	process.stderr.write(result.error.message);
	process.exit(127);
}
process.exit(result.status ?? 1);
`;

const placeEnrichmentRequiredVariables = [
	"EVENT_DB_ENRICHMENT_WORKER_PASSWORD",
	"EVENT_ENRICHMENT_WORKER_POLL_INTERVAL_MS",
	"EVENT_ENRICHMENT_WORKER_LEASE_MS",
	"EVENT_ENRICHMENT_PIPELINE_VERSION",
	"EVENT_ENRICHMENT_LLM_MODEL",
	"EVENT_ENRICHMENT_PROMPT_VERSION",
	"EVENT_ENRICHMENT_MAX_ATTEMPTS",
	"EVENT_ENRICHMENT_MAX_EXA_CALLS",
	"EVENT_ENRICHMENT_MAX_LLM_CALLS",
	"EVENT_ENRICHMENT_MAX_INPUT_TOKENS",
	"EVENT_ENRICHMENT_MAX_OUTPUT_TOKENS",
	"EVENT_ENRICHMENT_MAX_COST_MICROS",
	"EVENT_ENRICHMENT_PROVIDER_TIMEOUT_MS",
	"EVENT_ENRICHMENT_MAX_RESPONSE_BYTES",
	"EVENT_ENRICHMENT_EXA_BASE_URL",
	"EVENT_ENRICHMENT_EXA_API_KEY",
	"EVENT_ENRICHMENT_EXA_MAX_RESULTS",
	"EVENT_ENRICHMENT_EXA_MAX_COST_MICROS_PER_CALL",
	"EVENT_ENRICHMENT_LLM_URL",
	"EVENT_ENRICHMENT_LLM_ALLOWED_ORIGIN",
	"EVENT_ENRICHMENT_LLM_API_KEY",
	"EVENT_ENRICHMENT_LLM_MAX_OUTPUT_TOKENS_PER_CALL",
	"EVENT_ENRICHMENT_LLM_INPUT_COST_MICROS_PER_MILLION",
	"EVENT_ENRICHMENT_LLM_OUTPUT_COST_MICROS_PER_MILLION",
	"EVENT_ENRICHMENT_MAX_EVIDENCE_CHARACTERS",
	"EVENT_ENRICHMENT_BASE_BACKOFF_MS",
	"EVENT_ENRICHMENT_MAX_BACKOFF_MS",
] as const;

test("staging overlay fails closed on immutable release inputs", () => {
	expect(overlay.name).toBe("crew-next-staging");
	for (const service of [
		"api-gateway",
		"user-api",
		"magic-worker",
		"push-worker",
		"event-api",
		"attachment-worker",
		"notification-worker",
		"recap-retention-worker",
		"place-enrichment-worker",
		"place-golf-import",
		"place-search-reindex",
		"web",
	]) {
		expect(String(services[service]?.image)).toContain(
			`\${CREW_RELEASE_SHA:?CREW_RELEASE_SHA is required}`,
		);
	}
	for (const service of [
		"api-gateway",
		"user-api",
		"magic-worker",
		"push-worker",
		"event-api",
		"attachment-worker",
		"notification-worker",
		"recap-retention-worker",
		"place-enrichment-worker",
		"place-golf-import",
		"place-search-reindex",
	]) {
		expect(
			(services[service]?.environment as Record<string, unknown>)?.NODE_ENV,
		).toBe("production");
	}
	expect(overlaySource).not.toContain("crew-local-");
	expect(overlaySource).not.toContain("NODE_ENV: development");
	expect(
		(services["event-api"]?.environment as Record<string, unknown>)
			?.EVENT_ENRICHMENT_ENABLED,
	).toBe(`\${EVENT_ENRICHMENT_ENABLED:-false}`);
	const enrichmentWorker = services["place-enrichment-worker"] ?? {};
	const enrichmentEnvironment =
		(enrichmentWorker.environment as Record<string, unknown>) ?? {};
	expect(enrichmentWorker.image).toBe(
		`crew-next-event-service:\${CREW_RELEASE_SHA:?CREW_RELEASE_SHA is required}`,
	);
	expect(enrichmentWorker.ports).toBeUndefined();
	expect(composeSource).toContain(
		"place-enrichment-worker:\n    <<: *bun-runtime\n    profiles: [enrichment]",
	);
	expect(enrichmentEnvironment.EVENT_ENRICHMENT_WORKER_ID).toBe(
		`staging-place-enrichment-\${CREW_RELEASE_SHA:?CREW_RELEASE_SHA is required}`,
	);
	expect(enrichmentEnvironment.EVENT_ENRICHMENT_WORKER_DATABASE_URL).toBe(
		`postgres://crew_event_enrichment_worker:\${EVENT_DB_ENRICHMENT_WORKER_PASSWORD:-}@postgres:5432/crew_event`,
	);
	for (const variable of [
		"EVENT_ENRICHMENT_EXA_BASE_URL",
		"EVENT_ENRICHMENT_EXA_API_KEY",
		"EVENT_ENRICHMENT_LLM_URL",
		"EVENT_ENRICHMENT_LLM_ALLOWED_ORIGIN",
		"EVENT_ENRICHMENT_LLM_API_KEY",
	]) {
		expect(enrichmentEnvironment[variable]).toBe(`\${${variable}:-}`);
	}
	expect(composeSource).toContain(
		"PLACE_GOLF_IMPORT_OVERPASS_URL: http://provider-sink:3010/internal/fixtures/overpass/golf",
	);
	expect(
		(services["place-golf-import"]?.environment as Record<string, unknown>)
			?.PLACE_GOLF_IMPORT_OVERPASS_URL,
	).toBe("https://overpass-api.de/api/interpreter");
	expect(
		(services["place-golf-import"]?.environment as Record<string, unknown>)
			?.PLACE_GOLF_IMPORT_EVENT_SERVICE_URL,
	).toBe("https://staging.crew-haus.com:8447");
	expect(
		(services["place-search-reindex"]?.environment as Record<string, unknown>)
			?.PLACE_SEARCH_REINDEX_EVENT_SERVICE_URL,
	).toBe("https://staging.crew-haus.com:8447");
	expect(
		(services["notification-worker"]?.environment as Record<string, unknown>)
			?.EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID,
	).toBe("staging-notification-v1");
	expect(
		(services["notification-worker"]?.environment as Record<string, unknown>)
			?.EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY,
	).toBe(
		`\${EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:?EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY is required}`,
	);
	expect(overlaySource).not.toContain("staging-fixture-model");
});

test("private production dependencies terminate TLS at the isolated proxy", () => {
	expect(String(services["internal-tls"]?.image)).toBe(
		"haproxy:3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb",
	);
	expect(services["internal-tls"]?.ports).toEqual(["0.0.0.0:8444:8444"]);
	expect(
		(services["internal-tls"]?.healthcheck as Record<string, unknown>)?.test,
	).toEqual(["CMD", "nc", "-z", "-w", "1", "127.0.0.1", "6379"]);
	for (const port of ["6379", "8443", "8444", "8445", "8446", "8447"]) {
		expect(haproxy).toContain(`bind :${port} ssl crt`);
	}
	expect(haproxy).toContain("server event event-api:3002");
	expect(overlaySource).toContain(
		"rediss://crew_gateway:${REDIS_GATEWAY_PASSWORD:",
	);
	expect(overlaySource).toContain(
		"EVENT_OBJECT_STORE_ENDPOINT: https://staging.crew-haus.com:8444",
	);
	expect(overlaySource).toContain(
		"PLACE_SEARCH_TYPESENSE_URL: https://staging.crew-haus.com:8445",
	);
	expect(hostDeploy).toMatch(/typesense_admin_key=\$\(hex_secret\)/);
	expect(hostDeploy).toMatch(/typesense_search_key=\$\(hex_secret\)/);
	expect(hostDeploy).toContain(
		"Typesense admin and search-only keys must be different",
	);
	expect(hostDeploy).toContain('"actions": ["documents:search"]');
	expect(hostDeploy).toContain('"collections": ["crew_places.*"]');
	expect(hostDeploy).toContain("ensure_typesense_search_key");
	expect(hostDeploy).toContain("verify_typesense_search_key");
	expect(hostDeploy).toContain('.get("found", 0) < 1');
	expect(hostDeploy).toContain(
		"Crew place source unavailable; retaining the verified existing catalog",
	);
	expect(hostDeploy).toContain('import_status}" -eq 75 && -n "${source_sha');
	expect(
		(services["event-api"]?.environment as Record<string, unknown>)
			?.PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY,
	).toBe(`\${TYPESENSE_SEARCH_API_KEY:?TYPESENSE_SEARCH_API_KEY is required}`);
	expect(
		(services["place-search-reindex"]?.environment as Record<string, unknown>)
			?.PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY,
	).toBe(`\${TYPESENSE_API_KEY:?TYPESENSE_API_KEY is required}`);
	expect(hostDeploy).not.toMatch(
		/printf 'TYPESENSE_(?:API_KEY|SEARCH_API_KEY)=%s\\n' "\$\{typesense_key\}"/,
	);
});

test("host executor preserves data on rollback and leaves auditable proof", () => {
	expect(hostDeploy).toContain(
		"Target release must be a full lowercase Git SHA",
	);
	expect(hostDeploy).toContain("shopt -s inherit_errexit");
	expect(hostDeploy).toContain("checkout --quiet --detach");
	expect(hostDeploy).toContain("status --short");
	expect(hostDeploy).toContain(`chmod -R a=rX -- "\${release_dir}"`);
	expect(hostDeploy).not.toContain("build_images");
	expect(hostDeploy).not.toContain("docker build");
	expect(hostDeploy).toContain("load_target_image_manifest");
	expect(hostDeploy).toContain("pull_release_images");
	expect(hostDeploy).toContain("write_digest_override");
	expect(hostDeploy).toContain(`--file "\${override}"`);
	expect(hostDeploy.match(/pull_policy: never/g)?.length).toBe(18);
	for (const repository of [
		"ghcr.io/dischen87/crew-api-gateway",
		"ghcr.io/dischen87/crew-user-service",
		"ghcr.io/dischen87/crew-event-service",
		"ghcr.io/dischen87/crew-infra",
		"ghcr.io/dischen87/crew-rate-limit-redis",
		"ghcr.io/dischen87/crew-web",
	]) {
		expect(hostDeploy).toContain(repository);
	}
	expect(hostDeploy).toContain(
		`source}" != "https://github.com/dischen87/crew"`,
	);
	const installCaddyIndex = hostDeploy.lastIndexOf(
		`\ninstall_caddy "\${release_dir}"`,
	);
	for (const preflight of [
		"load_target_image_manifest",
		"pull_release_images",
		"write_digest_override",
		`compose_command "\${release_dir}" config --quiet`,
	]) {
		expect(hostDeploy.lastIndexOf(preflight)).toBeLessThan(installCaddyIndex);
	}
	const ensureEnvironmentIndex = hostDeploy.indexOf("\nensure_environment\n");
	const enrichmentPreflightIndex = hostDeploy.indexOf(
		"\nload_place_enrichment_configuration\n",
	);
	expect(ensureEnvironmentIndex).toBeGreaterThan(-1);
	expect(enrichmentPreflightIndex).toBeGreaterThan(ensureEnvironmentIndex);
	expect(enrichmentPreflightIndex).toBeLessThan(
		hostDeploy.indexOf("\nrelease_dir=$(checkout_release)\n"),
	);
	expect(
		hostDeploy.match(
			/^\s+reconcile_place_enrichment_worker "\$\{release_dir\}"$/gm,
		)?.length,
	).toBe(3);
	expect(hostDeploy.indexOf("place-golf-import")).toBeLessThan(
		hostDeploy.indexOf('\n\tsmoke "'),
	);
	expect(hostDeploy.indexOf("place-search-reindex")).toBeLessThan(
		hostDeploy.indexOf('\n\tsmoke "'),
	);
	expect(hostDeploy).toContain("--no-build --no-deps api-gateway");
	expect(hostDeploy).toContain(
		"event-api attachment-worker notification-worker recap-retention-worker",
	);
	expect(hostDeploy).not.toContain("down --volumes");
	expect(hostDeploy).not.toContain("DROP DATABASE");
	expect(hostDeploy).toContain("databaseReleaseId");
	expect(hostDeploy).toContain("database_release_dir=");
	expect(hostDeploy).toContain("database_contract_sha()");
	expect(hostDeploy).toContain("runtime_infrastructure_contract_sha()");
	expect(hostDeploy).toContain(
		'"kind": "identical-database-and-runtime-contract"',
	);
	expect(hostDeploy).toContain('"kind": "previous-runtime-on-target-contract"');
	for (const field of [
		"targetDatabaseReleaseId",
		"targetDatabaseContractSha256",
		"targetGrantSha256",
		"fromRuntimeInfrastructureContractSha256",
		"targetRuntimeInfrastructureContractSha256",
		"githubActionsRunId",
		"previousImages",
	]) {
		expect(hostDeploy).toContain(`"${field}"`);
	}
	expect(
		hostDeploy.match(/re\.escape\(repository\) \+ r"@sha256:\[0-9a-f\]\{64\}"/g)
			?.length,
	).toBeGreaterThanOrEqual(3);
	for (const [variable, image, requested] of [
		[
			"compatibility_previous_api_gateway_image",
			"api-gateway",
			"requested_api_gateway_image",
		],
		[
			"compatibility_previous_user_service_image",
			"user-service",
			"requested_user_service_image",
		],
		[
			"compatibility_previous_event_service_image",
			"event-service",
			"requested_event_service_image",
		],
		["compatibility_previous_infra_image", "infra", "requested_infra_image"],
		[
			"compatibility_previous_rate_limit_redis_image",
			"rate-limit-redis",
			"requested_rate_limit_redis_image",
		],
		["compatibility_previous_web_image", "web", "requested_web_image"],
	] as const) {
		expect(hostDeploy).toContain(`"${variable}": previous_images["${image}"]`);
		expect(hostDeploy).toContain(`"${image}": stored_images.get("${image}")`);
		expect(hostDeploy).toContain(`"${image}": ${requested}`);
	}
	for (const service of [
		"redis-rate-limit",
		"provider-sink",
		"fixture-bootstrap",
		"web",
	]) {
		expect(hostDeploy).toContain(`"${service}"`);
	}
	expect(hostDeploy).toContain(
		"Previous runtime images do not match the stored source manifest",
	);
	expect(hostDeploy).toContain('"previousImages": previous_images');
	expect(hostDeploy).toContain('"state": "target-database-previous-runtime"');
	expect(hostDeploy).toContain(
		"A forward compatibility transition must be resumed before rollback",
	);
	expect(hostDeploy).toContain(
		"A forward compatibility transition must be resumed before reset",
	);
	expect(
		hostDeploy.lastIndexOf(
			"A forward compatibility transition must be resumed before reset",
		),
	).toBeLessThan(
		hostDeploy.lastIndexOf(`prepare_greenfield_reset "\${source_sha}"`),
	);
	expect(hostDeploy.indexOf("prepare_forward_intent")).toBeLessThan(
		hostDeploy.lastIndexOf(`\ninstall_caddy "\${release_dir}"`),
	);
	expect(
		hostDeploy.lastIndexOf("record_forward_database_boundary"),
	).toBeLessThan(
		hostDeploy.lastIndexOf("user-api event-api magic-worker push-worker"),
	);
	expect(hostDeploy.lastIndexOf("complete_forward_intent")).toBeGreaterThan(
		hostDeploy.lastIndexOf(
			`activate_release_state "\${target_sha}" "\${target_sha}"`,
		),
	);
	expect(hostDeploy).toContain(
		"Completed forward transition evidence does not match",
	);
	const completedForwardResumeStart = hostDeploy.indexOf(
		"Completed forward transition evidence does not match",
	);
	const completedForwardResume = hostDeploy.slice(
		completedForwardResumeStart,
		hostDeploy.indexOf(
			"elif [[ $(database_contract_sha",
			completedForwardResumeStart,
		),
	);
	expect(
		completedForwardResume.indexOf("previous_runtime_proof validate"),
	).toBeLessThan(completedForwardResume.indexOf("complete_forward_intent"));
	expect(completedForwardResume).toContain("exit 0");
	expect(hostDeploy).toContain(
		"A forward compatibility transition requires resume-forward or abort-forward",
	);
	expect(hostDeploy).toContain(
		"Forward recovery requires the exact existing transition",
	);
	expect(hostDeploy).toContain(
		`( -e "\${forward_in_progress_file}" ||\n\t\t-L "\${forward_in_progress_file}" )`,
	);
	const abortForwardStart = hostDeploy.indexOf(
		`if [[ "\${abort_forward}" == true ]]; then`,
	);
	const abortForward = hostDeploy.slice(
		abortForwardStart,
		hostDeploy.indexOf(`\ninstall_caddy "\${release_dir}"`, abortForwardStart),
	);
	expect(abortForwardStart).toBeGreaterThan(-1);
	expect(
		abortForward.indexOf("jwt-bootstrap user-migrate event-migrate"),
	).toBeLessThan(abortForward.indexOf("record_forward_database_boundary"));
	expect(abortForward.indexOf("record_forward_database_boundary")).toBeLessThan(
		abortForward.indexOf("source_manifest="),
	);
	expect(abortForward.indexOf(`\tsmoke "\${release_dir}"`)).toBeLessThan(
		abortForward.indexOf("record_release forward-abort"),
	);
	expect(abortForward.indexOf("record_release forward-abort")).toBeLessThan(
		abortForward.lastIndexOf("activate_release_state"),
	);
	expect(abortForward.lastIndexOf("activate_release_state")).toBeLessThan(
		abortForward.indexOf("complete_forward_intent"),
	);
	expect(
		abortForward.indexOf(
			`arm_place_enrichment_failure_cleanup "\${compatibility_from_release_dir}"`,
		),
	).toBeLessThan(abortForward.indexOf("\n\t(\n"));
	expect(abortForward.lastIndexOf("activate_release_state")).toBeLessThan(
		abortForward.indexOf("disarm_place_enrichment_failure_cleanup"),
	);
	const deployRuntimeStart = hostDeploy.lastIndexOf(
		`if [[ "\${action}" == deploy ]]; then`,
	);
	const rollbackRuntimeStart = hostDeploy.lastIndexOf(
		`\nelse\n\tcompose_command "\${release_dir}" up -d --no-build --no-deps`,
	);
	const deployRuntime = hostDeploy.slice(
		deployRuntimeStart,
		rollbackRuntimeStart,
	);
	const rollbackRuntime = hostDeploy.slice(rollbackRuntimeStart);
	for (const runtime of [deployRuntime, rollbackRuntime]) {
		expect(runtime.indexOf("reconcile_place_enrichment_worker")).toBeLessThan(
			runtime.indexOf(`\tsmoke "\${release_dir}"`),
		);
		expect(runtime.indexOf(`\tsmoke "\${release_dir}"`)).toBeLessThan(
			runtime.indexOf("release_record=$(record_release"),
		);
		expect(runtime.indexOf("release_record=$(record_release")).toBeLessThan(
			runtime.lastIndexOf("activate_release_state"),
		);
		expect(runtime.lastIndexOf("activate_release_state")).toBeLessThan(
			runtime.indexOf("disarm_place_enrichment_failure_cleanup"),
		);
	}
	const recordRelease = hostDeploy.slice(
		hostDeploy.indexOf("record_release()"),
		hostDeploy.indexOf("\nactivate_release_state()"),
	);
	const finalEnrichmentVerification = recordRelease.indexOf(
		"verify_place_enrichment_release_state",
	);
	expect(recordRelease).toContain("if ! verify_place_enrichment_release_state");
	expect(finalEnrichmentVerification).toBeGreaterThan(
		recordRelease.indexOf("internal_tls_image_id=$(docker image inspect"),
	);
	expect(finalEnrichmentVerification).toBeLessThan(
		recordRelease.indexOf("\n\tprintf '%s\\n'"),
	);
	const currentEnrichmentRuntime = hostDeploy.slice(
		hostDeploy.indexOf("place_enrichment_runtime_is_current()"),
		hostDeploy.indexOf("\nverify_place_enrichment_release_state()"),
	);
	expect(currentEnrichmentRuntime).not.toContain(
		"ps -q --all place-enrichment-worker",
	);
	const verifyEnrichmentRuntime = hostDeploy.slice(
		hostDeploy.indexOf("verify_place_enrichment_release_state()"),
		hostDeploy.indexOf("\nreconcile_place_enrichment_worker()"),
	);
	expect(verifyEnrichmentRuntime).toContain(
		"ps -q --all place-enrichment-worker",
	);
	const reconcileEnrichmentRuntime = hostDeploy.slice(
		hostDeploy.indexOf("reconcile_place_enrichment_worker()"),
		hostDeploy.indexOf("\nverify_service_image_references()"),
	);
	expect(
		reconcileEnrichmentRuntime.indexOf(
			`arm_place_enrichment_failure_cleanup "\${release_dir}"`,
		),
	).toBeLessThan(
		reconcileEnrichmentRuntime.indexOf(
			`if ! compose_command "\${release_dir}" --profile enrichment up -d`,
		),
	);
	expect(
		reconcileEnrichmentRuntime.match(
			/^\tarm_place_enrichment_failure_cleanup/gm,
		)?.length,
	).toBe(1);
	expect(hostDeploy).toContain("validate_current_state");
	expect(hostDeploy).toContain("validate_compatibility_proof");
	expect(hostDeploy).toContain(
		"Forward deploy changes the database or runtime infrastructure contract; richer rollback evidence is required",
	);
	expect(hostDeploy).toContain(
		"Rollback target is not compatible with the active database or runtime infrastructure contract",
	);
	expect(hostDeploy).toContain("databaseCompatibilitySha256");
	expect(hostDeploy).toContain("runtimeInfrastructureCompatibilitySha256");
	expect(hostDeploy).toContain("imageManifestSha256");
	expect(hostDeploy).toContain("imageDistributionOverrideSha256");
	expect(hostDeploy).toContain("fromImageManifestSha256");
	expect(hostDeploy).toContain("toImageManifestSha256");
	expect(hostDeploy).toContain('"schemaVersion": 2');
	expect(hostDeploy).toContain(
		"legacy_digest_bridge_sha=b97b6bf355da0f1eb08aedc75263a9d8f2c48c6e",
	);
	expect(hostDeploy).toContain("verify_service_image_references");
	expect(hostDeploy).toContain(
		`runtime_contract_file="\${shared_dir}/runtime-infrastructure-contract-sha256"`,
	);
	expect(hostDeploy.lastIndexOf("\tvalidate_compatibility_proof")).toBeLessThan(
		hostDeploy.lastIndexOf(`\ninstall_caddy "\${release_dir}"`),
	);
	expect(hostDeploy).toContain(
		`\\"features\\": {\\"placeEnrichment\\": \\"\${place_enrichment_feature_state}\\"}`,
	);
	for (const state of [
		"disabled-no-provider-worker",
		"disabled-target-release-unsupported",
		"enabled-worker-healthy",
	]) {
		expect(hostDeploy).toContain(`{"placeEnrichment": "${state}"}`);
	}
	expect(hostDeploy).toContain(
		`place-enrichment-worker:\n    image: \${event_service_image}\n    pull_policy: never`,
	);
	expect(hostDeploy).toContain(
		"Place-enrichment worker runtime is not current for this release",
	);
	expect(hostDeploy).toContain(
		"DELETE FROM place_enrichment_worker_health WHERE singleton;",
	);
	expect(hostDeploy).toContain(
		`worker_id = '\${worker_id}' AND healthy_until > clock_timestamp()`,
	);
	expect(hostDeploy).toContain("disabled-target-release-unsupported");
	expect(hostDeploy).toContain(
		`EVENT_DB_ENRICHMENT_WORKER_PASSWORD="\${place_enrichment_database_password}"`,
	);
	expect(hostDeploy).toContain("infra/postgres/grant-runtime.sql");
	expect(hostDeploy).not.toContain(`"crew-next-web:\${target_sha}"`);
	expect(hostDeploy).toContain('\\"infra\\":');
	expect(hostDeploy).toContain('\\"rate-limit-redis\\":');
	expect(hostDeploy).toContain('\\"internal-tls\\":');
	expect(hostDeploy).toContain('"localImageIds": {');
	const rollbackInfrastructureRestart =
		"--force-recreate redis-rate-limit provider-sink internal-tls";
	expect(hostDeploy).toContain(rollbackInfrastructureRestart);
	expect(hostDeploy.indexOf(rollbackInfrastructureRestart)).toBeLessThan(
		hostDeploy.lastIndexOf("--no-build --no-deps api-gateway"),
	);
	expect(hostDeploy).toContain('"public-web"');
	expect(hostDeploy).toContain("verify_public_associations");
	expect(hostDeploy).toContain("--location --max-redirs 0");
	expect(hostDeploy).toContain(
		`[[ "\${apple_content_type}" == application/json ]]`,
	);
	expect(hostDeploy).toContain(
		'"Crew Android association must remain unpublished until signing is verified"',
	);
	expect(hostDeploy).toContain('"apple-app-site-association"');
	expect(hostDeploy).toContain('"android-assetlinks-fail-closed"');
	expect(hostDeploy).toContain('"smoke"');
	expect(hostDeploy).toContain('"feedback-attachment-e2e"');
	expect(hostDeploy).toContain("auth_run_id=$(openssl rand -hex 12)");
	expect(hostDeploy).toContain(`-e CREW_FIXTURE_AUTH_RUN_ID="\${auth_run_id}"`);
	expect(hostDeploy).toContain("-e CREW_FIXTURE_ATTACHMENT_E2E=1");
	expect(hostDeploy).toContain("-e CREW_FIXTURE_SCENARIO=team-event");
});

test("staging greenfield reset is one-shot, exact, and a rollback boundary", () => {
	expect(hostDeploy).toContain(
		`reset_consumed_file="\${reset_records_dir}/greenfield-reset-consumed.json"`,
	);
	expect(hostDeploy).toContain(
		`reset_in_progress_file="\${shared_dir}/reset-in-progress"`,
	);
	expect(hostDeploy).toContain(
		"Staging reset replay does not match the recorded intent",
	);
	expect(hostDeploy).toContain(
		"Crew staging greenfield reset was already consumed",
	);
	expect(hostDeploy).toContain(
		"Crew staging reset is incomplete; only the identical reset intent may resume",
	);
	expect(hostDeploy).toContain(
		"Staging reset expected current release does not match active staging",
	);
	expect(hostDeploy).toContain(
		"Crew staging reset volume state is neither intact nor deleted",
	);
	expect(hostDeploy).toContain("down --remove-orphans");
	expect(hostDeploy).toContain("--profile '*' down --remove-orphans");
	expect(hostDeploy).not.toContain("down --volumes");
	expect(hostDeploy).toContain(`docker volume rm -- "\${volume}"`);
	expect(hostDeploy).not.toContain("docker volume rm -f");
	expect(hostDeploy).not.toContain("docker volume prune");
	expect(hostDeploy).not.toContain("docker system prune");
	expect(hostDeploy).not.toContain(`docker "\${resource}" ls --all`);
	expect(hostDeploy).toContain("docker container ls --all --quiet");
	expect(hostDeploy).toContain("docker volume ls --quiet");
	expect(hostDeploy).toContain("docker network ls --quiet");
	expect(hostDeploy).toContain("docker network ls --format '{{.Name}}'");
	expect(hostDeploy).toContain("--profile '*' config --services");
	for (const volume of [
		"crew-next-staging_postgres_data",
		"crew-next-staging_redis_rate_limit_data",
		"crew-next-staging_minio_data",
		"crew-next-staging_typesense_data",
		"crew-next-staging_user_jwt_keys",
	]) {
		expect(hostDeploy).toContain(volume);
	}
	expect(hostDeploy).toContain(
		'{{index .Labels "com.docker.compose.project"}}',
	);
	expect(hostDeploy).toContain('{{index .Labels "com.docker.compose.volume"}}');
	expect(hostDeploy).toContain(
		"Stored image manifests cannot request a staging reset",
	);
	expect(hostDeploy).toContain(
		`"\${source}" "\${canonical}" "\${environment_output}" "\${target_sha}" true`,
	);
	expect(hostDeploy).toContain(
		`"\${manifest}" "\${canonical}" "\${environment_output}" "\${target_sha}" false`,
	);
	const prepareReset = hostDeploy.slice(
		hostDeploy.indexOf("prepare_greenfield_reset()"),
		hostDeploy.indexOf("\nrun_job()"),
	);
	expect(prepareReset.indexOf("write_reset_audit")).toBeLessThan(
		prepareReset.indexOf("reset_greenfield_staging"),
	);
	expect(prepareReset.indexOf("verify_reset_environment")).toBeLessThan(
		prepareReset.indexOf("reset_greenfield_staging"),
	);
	expect(prepareReset.indexOf("verify_reset_source_volumes")).toBeLessThan(
		prepareReset.lastIndexOf("reset_greenfield_staging"),
	);
	expect(
		hostDeploy.lastIndexOf(
			`activate_release_state "\${target_sha}" "\${target_sha}" "\${release_record}"`,
		),
	).toBeLessThan(
		hostDeploy.lastIndexOf(`complete_greenfield_reset "\${release_record}"`),
	);
	const activateState = hostDeploy.slice(
		hostDeploy.indexOf("activate_release_state()"),
		hostDeploy.indexOf("\nensure_environment\n"),
	);
	const currentReleaseMove = activateState.indexOf(
		`mv "\${temporary}" "\${current_file}"`,
	);
	expect(
		activateState.indexOf(`mv "\${pointer_temporary}" "\${record_pointer}"`),
	).toBeLessThan(currentReleaseMove);
	expect(
		activateState.indexOf(`mv "\${temporary}" "\${current_record_file}"`),
	).toBeGreaterThan(currentReleaseMove);
	expect(hostDeploy).toContain('\\"action\\":');
	expect(hostDeploy).toContain('\\"dataReset\\":');
	expect(hostDeploy).toContain('\\"resetId\\":');
	expect(hostDeploy).toContain('\\"databaseLineageId\\":');
	expect(hostDeploy).toContain(
		"Rollback cannot cross a staging reset boundary",
	);
	expect(
		hostDeploy.lastIndexOf("\tenforce_reset_rollback_boundary"),
	).toBeLessThan(hostDeploy.lastIndexOf(`\ninstall_caddy "\${release_dir}"`));
});

test("staging reset shell rejects foreign scope and ignores similar-project decoys", () => {
	const resetVolumes = hostDeploy.slice(
		hostDeploy.indexOf("reset_expected_volumes()"),
		hostDeploy.indexOf("\nreset_completed_path()"),
	);
	const validateResources = hostDeploy.slice(
		hostDeploy.indexOf("validate_reset_resources()"),
		hostDeploy.indexOf("\nreset_greenfield_staging()"),
	);
	const resetScript = `${resetVolumes}\n${validateResources}\n${String.raw`
set -Eeuo pipefail
scenario=${"$"}{SCENARIO:?}
inspect_log=${"$"}{INSPECT_LOG:?}
error_log=${"$"}{ERROR_LOG:?}
exec 2>"$error_log"
compose_with_override() {
	[[ "$4" == --profile && "$5" == '*' && "$6" == config && "$7" == --services ]]
	printf '%s\n' web internal-tls place-golf-import
}
present_volumes=$'crew-next-staging_minio_data\ncrew-next-staging_postgres_data'
decoy=crew-next-stagingish_postgres_data
docker() {
	if [[ "$1 $2 $3" == "volume ls --format" ]]; then
		printf '%s\n' "$present_volumes"
		if [[ "$scenario" == unexpected-volume ]]; then
			printf '%s\n' crew-next-staging_decoy_data
		fi
	elif [[ "$1 $2 $3" == "network ls --format" ]]; then
		printf '%s\n' crew-next-staging_default
	elif [[ "$1 $2" == "volume inspect" ]]; then
		printf '%s\n' "$3" >>"$inspect_log"
		[[ "$3" != "$decoy" ]] || return 0
		grep -Fxq "$3" <<<"$present_volumes" || return 1
		if [[ "${"$"}{4:-}" == --format ]]; then
			if [[ "$scenario" == wrong-volume-label &&
				"$3" == crew-next-staging_minio_data ]]; then
				printf '%s\n' 'local|other-project|minio_data'
			else
				printf 'local|crew-next-staging|%s\n' "${"$"}{3#crew-next-staging_}"
			fi
		fi
	elif [[ "$1 $2" == "container ls" ]]; then
		if [[ "$scenario" == foreign-volume &&
			"$*" == *"volume=crew-next-staging_minio_data"* ]]; then
			printf '%s\n' c-foreign
		elif [[ "$*" != *"volume="* ]]; then
			printf '%s\n' c-web c-tls c-tool
		fi
	elif [[ "$1 $2" == "container inspect" ]]; then
		if [[ "$3" == c-foreign ]]; then
			printf '%s\n' other-project
		elif [[ "$*" == *"com.docker.compose.service"* ]]; then
			case "$3" in
				c-web) printf '%s\n' web ;;
				c-tls) printf '%s\n' internal-tls ;;
				c-tool) printf '%s\n' place-golf-import ;;
			esac
		else
			printf '%s\n' crew-next-staging
		fi
	elif [[ "$1 $2" == "network inspect" ]]; then
		if [[ "$*" == *"com.docker.compose.network"* ]]; then
			if [[ "$scenario" == wrong-network-label ]]; then
				printf '%s\n' 'bridge|crew-next-staging|foreign'
			else
				printf '%s\n' 'bridge|crew-next-staging|default'
			fi
		elif [[ "$scenario" == foreign-network ]]; then
			printf '%s\n' c-foreign
		fi
	else
		return 1
	fi
}
deploy_root=/unused
validate_reset_resources /unused consumed aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /unused
`}`;
	const directory = mkdtempSync(join(tmpdir(), "crew-reset-resources-"));
	try {
		const script = join(directory, "reset-resources.sh");
		writeFileSync(script, resetScript);
		const scenarios = [
			["positive", 0, ""],
			[
				"unexpected-volume",
				1,
				"Crew staging reset found an unexpected project volume",
			],
			["wrong-volume-label", 1, "Crew staging reset volume labels are invalid"],
			[
				"wrong-network-label",
				1,
				"Crew staging reset network labels are invalid",
			],
			[
				"foreign-volume",
				1,
				"Crew staging reset volume is attached to a foreign container",
			],
			[
				"foreign-network",
				1,
				"Crew staging reset network has a foreign container",
			],
			["decoy", 0, ""],
		] as const;
		for (const [scenario, status, error] of scenarios) {
			const inspectLog = join(directory, `${scenario}.inspect`);
			const errorLog = join(directory, `${scenario}.error`);
			writeFileSync(inspectLog, "");
			writeFileSync(errorLog, "");
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script],
				{
					encoding: "utf8",
					env: {
						PATH: process.env.PATH ?? "/usr/bin:/bin",
						SCENARIO: scenario,
						INSPECT_LOG: inspectLog,
						ERROR_LOG: errorLog,
					},
				},
			);
			const stderr = readFileSync(errorLog, "utf8");
			expect(result.status, `${scenario}: ${stderr}`).toBe(status);
			if (error) expect(stderr).toContain(error);
			if (scenario === "decoy") {
				expect(readFileSync(inspectLog, "utf8")).not.toContain(
					"crew-next-stagingish_postgres_data",
				);
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("staging reset removes only five volumes and restarts a partial target", () => {
	const resetVolumes = hostDeploy.slice(
		hostDeploy.indexOf("reset_expected_volumes()"),
		hostDeploy.indexOf("\nreset_completed_path()"),
	);
	const validateResources = hostDeploy.slice(
		hostDeploy.indexOf("validate_reset_resources()"),
		hostDeploy.indexOf("\nreset_greenfield_staging()"),
	);
	const resetGreenfield = hostDeploy.slice(
		hostDeploy.indexOf("reset_greenfield_staging()"),
		hostDeploy.indexOf("\ncomplete_greenfield_reset()"),
	);
	const resetScript = `${resetVolumes}\n${validateResources}\n${resetGreenfield}\n${String.raw`
set -Eeuo pipefail
sandbox=$1
first_log=$2
second_log=$3
decoy=crew-next-stagingish_postgres_data
present_volumes=$(reset_expected_volumes)
generation=old
network_present=true
rm_log=$first_log
compose_with_override() {
	if [[ "$4" == --profile && "$5" == '*' && "$6" == config && "$7" == --services ]]; then
		printf '%s\n' web internal-tls place-golf-import
	elif [[ "$4" == --profile && "$5" == '*' && "$6" == down && "$7" == --remove-orphans ]]; then
		network_present=false
	else
		return 1
	fi
}
reset_volume_metadata() {
	local volume logical
	for volume in $(reset_expected_volumes); do
		logical=${"$"}{volume#crew-next-staging_}
		printf '%s\told-%s\n' "$volume" "$logical"
	done
}
reset_deleted_path() {
	printf '%s/%s.deleted\n' "$reset_records_dir" "$1"
}
docker() {
	if [[ "$1 $2" == "volume ls" ]]; then
		[[ -z "$present_volumes" ]] || printf '%s\n' "$present_volumes"
	elif [[ "$1 $2" == "network ls" ]]; then
		[[ "$network_present" != true ]] || printf '%s\n' crew-next-staging_default
	elif [[ "$1 $2" == "volume inspect" ]]; then
		[[ "$3" != "$decoy" ]] || return 0
		grep -Fxq "$3" <<<"$present_volumes" || return 1
		if [[ "${"$"}{4:-}" == --format ]]; then
			logical=${"$"}{3#crew-next-staging_}
			if [[ "$*" == *".CreatedAt"* ]]; then
				printf '%s|local|crew-next-staging|%s\n' "$generation-$logical" "$logical"
			else
				printf 'local|crew-next-staging|%s\n' "$logical"
			fi
		fi
	elif [[ "$1 $2" == "volume rm" ]]; then
		[[ "$3" == -- ]]
		printf '%s\n' "$4" >>"$rm_log"
		present_volumes=$(grep -Fvx "$4" <<<"$present_volumes" || true)
	elif [[ "$1 $2" == "container ls" ]]; then
		:
	elif [[ "$1 $2" == "container inspect" ]]; then
		printf '%s\n' crew-next-staging
	elif [[ "$1 $2" == "network inspect" ]]; then
		if [[ "$*" == *"com.docker.compose.network"* ]]; then
			printf '%s\n' 'bridge|crew-next-staging|default'
		fi
	else
		return 1
	fi
}
deploy_root=$sandbox
shared_dir=$sandbox
reset_records_dir=$sandbox
reset_id=github-actions-1
current_file=$sandbox/current-release
previous_file=$sandbox/previous-release
database_file=$sandbox/database-release
database_lineage_file=$sandbox/database-lineage
grant_file=$sandbox/runtime-grant
database_contract_file=$sandbox/database-contract
runtime_contract_file=$sandbox/runtime-contract
current_record_file=$sandbox/current-record
reset_greenfield_staging /unused aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /unused consumed
present_volumes=$'crew-next-staging_postgres_data\ncrew-next-staging_typesense_data'
generation=fresh
network_present=true
rm_log=$second_log
reset_greenfield_staging /unused aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /unused deleted
docker volume inspect "$decoy"
`}`;
	const directory = mkdtempSync(join(tmpdir(), "crew-reset-delete-"));
	try {
		const script = join(directory, "reset-delete.sh");
		const firstLog = join(directory, "first.log");
		const secondLog = join(directory, "second.log");
		writeFileSync(script, resetScript);
		const result = spawnSync(
			"/bin/bash",
			[script, directory, firstLog, secondLog],
			{
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
			},
		);
		if (result.status !== 0) {
			throw new Error(
				`delete harness failed status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
			);
		}
		expect(readFileSync(firstLog, "utf8").trim().split("\n")).toEqual([
			"crew-next-staging_minio_data",
			"crew-next-staging_postgres_data",
			"crew-next-staging_redis_rate_limit_data",
			"crew-next-staging_typesense_data",
			"crew-next-staging_user_jwt_keys",
		]);
		expect(readFileSync(secondLog, "utf8").trim().split("\n")).toEqual([
			"crew-next-staging_postgres_data",
			"crew-next-staging_typesense_data",
		]);
		expect(
			`${readFileSync(firstLog, "utf8")}${readFileSync(secondLog, "utf8")}`,
		).not.toContain("crew-next-stagingish_postgres_data");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 15_000);

test("reset digest drift reuses the stored manifest and keeps its intent", () => {
	const canonicalizeManifest = hostDeploy.slice(
		hostDeploy.indexOf("canonicalize_image_manifest()"),
		hostDeploy.indexOf("\nimage_manifest_sha()"),
	);
	const loadManifest = hostDeploy.slice(
		hostDeploy.indexOf("load_target_image_manifest()"),
		hostDeploy.indexOf("\nvalidate_record()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-reset-manifest-"));
	const targetSha = "a".repeat(40);
	const expectedCurrentSha = "b".repeat(40);
	const repositories = {
		"api-gateway": "ghcr.io/dischen87/crew-api-gateway",
		"user-service": "ghcr.io/dischen87/crew-user-service",
		"event-service": "ghcr.io/dischen87/crew-event-service",
		infra: "ghcr.io/dischen87/crew-infra",
		"rate-limit-redis": "ghcr.io/dischen87/crew-rate-limit-redis",
		web: "ghcr.io/dischen87/crew-web",
	};
	const manifest = (digest: string) => ({
		schemaVersion: 1,
		releaseId: targetSha,
		platform: "linux/amd64",
		images: Object.fromEntries(
			Object.entries(repositories).map(([name, repository]) => [
				name,
				`${repository}@sha256:${digest.repeat(64)}`,
			]),
		),
	});
	try {
		const storedPath = join(directory, `${targetSha}.json`);
		const requestedPath = join(directory, "requested.json");
		const resultPath = join(directory, "result.txt");
		writeFileSync(storedPath, `${JSON.stringify(manifest("1"))}\n`, {
			mode: 0o600,
		});
		writeFileSync(
			requestedPath,
			`${JSON.stringify({
				...manifest("2"),
				resetStaging: {
					id: "github-actions-42",
					environment: "crew-next-staging",
					expectedCurrentReleaseId: expectedCurrentSha,
				},
			})}\n`,
		);
		const scriptPath = join(directory, "manifest.sh");
		writeFileSync(
			scriptPath,
			`${String.raw`
set -Eeuo pipefail
manifests_dir=$1
target_sha=$2
CREW_IMAGE_MANIFEST_SOURCE=$3
result_file=$4
stat() { printf '%s\n' root:root:600; }
`}\n${canonicalizeManifest}\n${loadManifest}\n${String.raw`
load_target_image_manifest
printf '%s\n' \
	"$api_gateway_image" \
	"$reset_staging_data" \
	"$reset_id" \
	"$reset_expected_current_sha" \
	"$target_manifest_sha" >"$result_file"
`}`,
		);
		const result = spawnSync(
			"node",
			[
				"-e",
				nativeSpawn,
				"/bin/bash",
				scriptPath,
				directory,
				targetSha,
				requestedPath,
				resultPath,
			],
			{
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
			},
		);
		const stderr = result.stderr;
		if (result.status !== 0) {
			throw new Error(
				`manifest harness failed status=${result.status} signal=${result.signal} error=${result.error}\nstderr=${stderr}`,
			);
		}
		expect(readFileSync(resultPath, "utf8").trim().split("\n")).toEqual([
			`ghcr.io/dischen87/crew-api-gateway@sha256:${"1".repeat(64)}`,
			"true",
			"github-actions-42",
			expectedCurrentSha,
			expect.stringMatching(/^[0-9a-f]{64}$/),
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("embedded host Python heredocs compile", () => {
	const blocks = [
		...hostDeploy.matchAll(/<<'PY'\n([\s\S]*?)\nPY(?=\n|$)/g),
	].map((match) => match[1]);
	expect(blocks.length).toBeGreaterThan(0);
	for (const [index, block] of blocks.entries()) {
		const result = spawnSync(
			"node",
			[
				"-e",
				nativeSpawn,
				"python3",
				"-c",
				"import sys; compile(sys.stdin.read(), '<heredoc>', 'exec')",
			],
			{
				encoding: "utf8",
				input: block,
			},
		);
		expect(result.status, `heredoc ${index}: ${result.stderr}`).toBe(0);
	}
});

test("staging activation keeps old committed pointers when current-release fails", () => {
	const activateStart = hostDeploy.indexOf("activate_release_state()");
	const activateRelease = hostDeploy.slice(
		activateStart,
		hostDeploy.indexOf(
			"\ntrap 'place_enrichment_failure_cleanup'",
			activateStart,
		),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-reset-activation-"));
	try {
		const result = spawnSync(
			"bash",
			[
				"-c",
				`${String.raw`
set -Eeuo pipefail
deploy_root=$1
shared_dir="${"$"}{deploy_root}/shared"
releases_dir="${"$"}{deploy_root}/releases"
records_dir="${"$"}{shared_dir}/records"
current_file="${"$"}{shared_dir}/current-release"
database_file="${"$"}{shared_dir}/database-release"
database_lineage_file="${"$"}{shared_dir}/database-lineage"
grant_file="${"$"}{shared_dir}/runtime-grant-sha256"
database_contract_file="${"$"}{shared_dir}/database-contract-sha256"
runtime_contract_file="${"$"}{shared_dir}/runtime-infrastructure-contract-sha256"
current_record_file="${"$"}{shared_dir}/current-record"
database_lineage_id=github-actions-1
old_sha=cccccccccccccccccccccccccccccccccccccccc
old_record="${"$"}{shared_dir}/old-record.json"
mkdir -p \
	"${"$"}{records_dir}" \
	"${"$"}{releases_dir}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
printf '%s\n' "${"$"}{old_sha}" >"${"$"}{current_file}"
printf '%s\n' "${"$"}{old_record}" >"${"$"}{current_record_file}"
runtime_grant_sha() { printf '%s\n' grant; }
database_contract_sha() { printf '%s\n' database-contract; }
runtime_infrastructure_contract_sha() { printf '%s\n' runtime-contract; }
mv() {
	[[ "${"$"}{2:-}" != "${"$"}{current_file}" ]] || return 1
	command mv "$@"
}
`}\n${activateRelease}\n${String.raw`
if activate_release_state \
	bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
	bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
	"${"$"}{shared_dir}/record.json"; then
	exit 1
fi
[[ $(cat "${"$"}{current_file}") == "${"$"}{old_sha}" ]]
[[ $(cat "${"$"}{current_record_file}") == "${"$"}{old_record}" ]]
[[ $(cat "${"$"}{records_dir}/active-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.record") == \
	"${"$"}{shared_dir}/record.json" ]]
[[ -e "${"$"}{database_file}" && -e "${"$"}{database_lineage_file}" ]]
[[ -e "${"$"}{grant_file}" && -e "${"$"}{database_contract_file}" ]]
[[ -e "${"$"}{runtime_contract_file}" ]]
[[ -L "${"$"}{deploy_root}/current" ]]
`}`,
				"crew-reset-activation-test",
				directory,
			],
			{
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
			},
		);
		if (result.status !== 0) {
			throw new Error(
				`activation harness failed status=${result.status} signal=${result.signal} error=${result.error}\nstdout=${result.stdout}\nstderr=${result.stderr}`,
			);
		}
		expect(result.status).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("staging release publishes six digests behind the reviewed environment", () => {
	const workflow = Bun.YAML.parse(releaseWorkflow) as {
		on?: {
			workflow_dispatch?: {
				inputs?: Record<string, Record<string, unknown>>;
			};
		};
		permissions?: Record<string, unknown>;
		jobs?: Record<string, Record<string, unknown>>;
	};
	expect(workflow.permissions).toEqual({ contents: "read" });
	expect(workflow.jobs?.publish?.permissions).toEqual({
		actions: "read",
		contents: "read",
		packages: "write",
	});
	expect(workflow.jobs?.deploy?.environment).toEqual({
		name: "crew-next-staging",
		url: "https://staging.crew-haus.com",
	});
	expect(
		workflow.on?.workflow_dispatch?.inputs?.reset_staging_data,
	).toMatchObject({
		required: true,
		default: false,
		type: "boolean",
	});
	expect(
		workflow.on?.workflow_dispatch?.inputs?.expected_current_staging_sha,
	).toMatchObject({
		required: false,
		default: "",
		type: "string",
	});
	expect(workflow.on?.workflow_dispatch?.inputs?.resume_reset_id).toMatchObject(
		{
			required: false,
			default: "",
			type: "string",
		},
	);
	expect(
		workflow.on?.workflow_dispatch?.inputs?.forward_recovery,
	).toMatchObject({
		required: true,
		default: "none",
		type: "choice",
		options: ["none", "resume", "abort"],
	});
	for (const action of [
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
		"docker/login-action@abd2ef45e78c5afb21d64d4ca52ee8550d9572c7",
		"docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c",
		"docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
		"actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
		"actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
	]) {
		expect(releaseWorkflow).toContain(action);
	}
	for (const image of [
		"crew-api-gateway",
		"crew-user-service",
		"crew-event-service",
		"crew-infra",
		"crew-rate-limit-redis",
		"crew-web",
	]) {
		expect(releaseWorkflow).toContain(
			`ghcr.io/dischen87/${image}:\${{ inputs.release_sha }}`,
		);
	}
	expect(releaseWorkflow).toContain("git merge-base --is-ancestor");
	expect(releaseWorkflow).toContain(
		`test "$(git rev-parse origin/main)" = "$RELEASE_SHA"`,
	);
	expect(releaseWorkflow).toContain("crew-next-ci.yml/runs");
	expect(releaseWorkflow).toContain("status=success");
	expect(releaseWorkflow).toContain("platforms: linux/amd64");
	expect(releaseWorkflow).toContain(
		["org.opencontainers.image.source=", "$", "{{ env.IMAGE_SOURCE }}"].join(
			"",
		),
	);
	expect(releaseWorkflow).toContain(
		[
			"org.opencontainers.image.revision=",
			"$",
			"{{ inputs.release_sha }}",
		].join(""),
	);
	expect(releaseWorkflow).toContain(
		"apps/mobile/evidence/event-hub-option-2/reference-390x844.png",
	);
	expect(releaseWorkflow).toContain("crew-staging-image-manifest.json");
	expect(releaseWorkflow).toContain(
		`"\${target_compose[@]}" --profile enrichment config --services`,
	);
	expect(releaseWorkflow).toContain(
		"Place-enrichment worker must remain default-off",
	);
	expect(releaseWorkflow).toContain(
		"Audited previous runtime unexpectedly contains place enrichment",
	);
	expect(releaseWorkflow.match(/"place-enrichment-default-off"/g)?.length).toBe(
		2,
	);
	expect(releaseWorkflow).toContain("if: inputs.deploy");
	expect(releaseWorkflow).toContain("reuse_stored_manifest:");
	expect(releaseWorkflow).toContain("reset_staging_data:");
	expect(releaseWorkflow).toContain("expected_current_staging_sha:");
	expect(releaseWorkflow).toContain("resume_reset_id:");
	expect(releaseWorkflow).toContain("forward_recovery:");
	expect(releaseWorkflow).toContain('test "$DEPLOY_REQUESTED" = true');
	expect(releaseWorkflow).toContain('test "$REUSE_STORED_MANIFEST" = false');
	expect(releaseWorkflow).toContain(
		'[[ "$EXPECTED_CURRENT_STAGING_SHA" =~ ^[0-9a-f]{40}$ ]]',
	);
	expect(releaseWorkflow).toContain('test -z "$EXPECTED_CURRENT_STAGING_SHA"');
	expect(releaseWorkflow).toContain('manifest["resetStaging"]');
	expect(releaseWorkflow).toContain(
		'"expectedCurrentReleaseId": expected_current',
	);
	expect(releaseWorkflow).toContain(
		'[[ "$RESUME_RESET_ID" =~ ^github-actions-[0-9]+$ ]]',
	);
	expect(releaseWorkflow).toContain('test "$REUSE_STORED_MANIFEST" = true');
	expect(releaseWorkflow).toContain('test "$RESET_STAGING_DATA" = false');
	expect(releaseWorkflow).toContain(
		'remote_command="resume-reset $RELEASE_SHA $RESUME_RESET_ID"',
	);
	expect(releaseWorkflow).toContain(
		'remote_command="resume-forward $RELEASE_SHA"',
	);
	expect(releaseWorkflow).toContain(
		'remote_command="abort-forward $RELEASE_SHA"',
	);
	expect(releaseWorkflow).toContain('remote_command="redeploy $RELEASE_SHA"');
	expect(releaseWorkflow).toContain(
		'test "$CREW_STAGING_DEPLOY_TARGET" = root@49.12.64.155',
	);
	expect(releaseWorkflow).toContain("StrictHostKeyChecking=yes");
	expect(releaseWorkflow).not.toContain("StrictHostKeyChecking=no");
	for (const use of releaseWorkflow.matchAll(/uses:\s+([^\s]+)/g)) {
		expect(use[1]).toMatch(/@[0-9a-f]{40}$/);
	}
});

test("GitHub deploy key is constrained to the current main controller", () => {
	expect(githubDeploy).toContain("SSH_ORIGINAL_COMMAND");
	expect(githubDeploy).toContain(
		"^deploy\\ ([0-9a-f]{40})\\ ([A-Za-z0-9+/]+={0,2})$",
	);
	expect(githubDeploy).toContain("^rollback\\ ([0-9a-f]{40})$");
	expect(githubDeploy).toContain("^redeploy\\ ([0-9a-f]{40})$");
	expect(githubDeploy).toContain(
		"^resume-reset\\ ([0-9a-f]{40})\\ (github-actions-[0-9]+)$",
	);
	expect(githubDeploy).toContain("^(resume|abort)-forward\\ ([0-9a-f]{40})$");
	expect(githubDeploy).toContain(
		`[[ "\${target_sha}" == "\${controller_sha}" ]]`,
	);
	expect(githubDeploy).toContain("merge-base --is-ancestor");
	expect(githubDeploy).toContain(
		"Reset resume target must be an ancestor of current main",
	);
	expect(githubDeploy).toContain(
		"Forward recovery target must be an ancestor of current main",
	);
	expect(githubDeploy).toContain(
		`\${controller_sha}:infra/staging/host-release.sh`,
	);
	expect(githubDeploy).toContain("env -i");
	expect(githubDeploy).toContain("CREW_IMAGE_MANIFEST_SOURCE");
	expect(githubDeploy).toContain(`CREW_RESET_RESUME_ID="\${reset_resume_id}"`);
	expect(githubDeploy).toContain(
		`CREW_FORWARD_RECOVERY="\${forward_recovery}"`,
	);
	expect(hostDeploy).toContain(`[[ -n "\${requested_id}" ]] || return 0`);
	expect(hostDeploy).toContain(
		`[[ "\${reset_staging_data}" != true ]] || return 0`,
	);
	expect(hostDeploy).toContain(
		`[[ -f "\${reset_consumed_file}" ]] || return 0`,
	);
	expect(githubDeploy).toContain(`manifest_dir="\${shared_dir}/manifests"`);
	expect(githubDeploy).not.toContain("/shared/environment");
	expect(githubDeploy).not.toContain("eval ");
	expect(githubDeploy).not.toContain("StrictHostKeyChecking=no");
});

test("place-enrichment enablement fails closed before release mutation", () => {
	const configurationFunctions = hostDeploy.slice(
		hostDeploy.indexOf("environment_value()"),
		hostDeploy.indexOf("\nensure_environment()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-enrichment-config-"));
	try {
		const script = join(directory, "enrichment-config.sh");
		const environment = join(directory, "environment");
		writeFileSync(
			script,
			`${configurationFunctions}
set -Eeuo pipefail
environment_file=$1
place_enrichment_requested=false
load_place_enrichment_configuration
printf '%s\n' "$place_enrichment_requested"
`,
		);
		const run = (lines: string[]) => {
			writeFileSync(
				environment,
				lines.length > 0 ? `${lines.join("\n")}\n` : "",
			);
			return spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, environment],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
		};
		for (const lines of [[], ["EVENT_ENRICHMENT_ENABLED=false"]]) {
			const result = run(lines);
			expect(result.status, result.stderr).toBe(0);
		}
		for (const lines of [
			["EVENT_ENRICHMENT_ENABLED=yes"],
			["EVENT_ENRICHMENT_ENABLED=true", "EVENT_ENRICHMENT_ENABLED=false"],
			["EVENT_ENRICHMENT_ENABLED=true"],
		]) {
			const result = run(lines);
			expect(result.status).not.toBe(0);
		}
		const complete = run([
			"EVENT_ENRICHMENT_ENABLED=true",
			...placeEnrichmentRequiredVariables.map((name) => `${name}=x`),
		]);
		expect(complete.status, complete.stderr).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("place-enrichment Compose password follows only validated enablement", () => {
	const configurationFunctions = hostDeploy.slice(
		hostDeploy.indexOf("environment_value()"),
		hostDeploy.indexOf("\nensure_environment()"),
	);
	const composeWithOverride = hostDeploy.slice(
		hostDeploy.indexOf("compose_with_override()"),
		hostDeploy.indexOf("\ncompose_command()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-enrichment-password-"));
	try {
		const script = join(directory, "compose-password.sh");
		const environment = join(directory, "environment");
		const output = join(directory, "password");
		writeFileSync(
			script,
			`${configurationFunctions}
${composeWithOverride}
${String.raw`
set -Eeuo pipefail
environment_file=$1
output=$2
shared_dir=/shared
place_enrichment_requested=false
place_enrichment_database_password=
docker() {
	printf '%s' "$EVENT_DB_ENRICHMENT_WORKER_PASSWORD" >"$output"
}
load_place_enrichment_configuration
compose_with_override \
	/release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa /override config
`}`,
		);
		const run = (lines: string[]) => {
			writeFileSync(environment, `${lines.join("\n")}\n`);
			writeFileSync(output, "not-called");
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, environment, output],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			return { result, password: readFileSync(output, "utf8") };
		};
		const disabled = run([
			"EVENT_ENRICHMENT_ENABLED=false",
			"EVENT_DB_ENRICHMENT_WORKER_PASSWORD=retained-secret",
		]);
		expect(disabled.result.status, disabled.result.stderr).toBe(0);
		expect(disabled.password).toBe("");
		const enabled = run([
			"EVENT_ENRICHMENT_ENABLED=true",
			...placeEnrichmentRequiredVariables.map((name) =>
				name === "EVENT_DB_ENRICHMENT_WORKER_PASSWORD"
					? `${name}=validated-secret`
					: `${name}=x`,
			),
		]);
		expect(enabled.result.status, enabled.result.stderr).toBe(0);
		expect(enabled.password).toBe("validated-secret");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("place-enrichment start and initial-gate failures always remove runtime state", () => {
	const runtimeFunctions = hostDeploy.slice(
		hostDeploy.indexOf("release_supports_place_enrichment()"),
		hostDeploy.indexOf("\nverify_service_image_references()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-enrichment-start-"));
	try {
		const script = join(directory, "enrichment-start.sh");
		writeFileSync(
			script,
			`${runtimeFunctions}
${String.raw`
set -Eeuo pipefail
scenario=$1
log=$2
target_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
event_service_image=event-service@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
place_enrichment_requested=true
place_enrichment_enabled=false
place_enrichment_feature_state=disabled-no-provider-worker
place_enrichment_cleanup_armed=false
place_enrichment_cleanup_release_dir=
place_enrichment_cleanup_running=false
release_supports_place_enrichment() { return 0; }
compose_command() {
	printf '%s\n' "$*" >>"$log"
	case "$*" in
		*" up -d "*"place-enrichment-worker"*)
			[[ "$scenario" != up-fail ]]
			;;
		*" ps -q place-enrichment-worker"*)
			printf 'worker-container\n'
			;;
		*"SELECT count(*) FROM place_enrichment_worker_health"*)
			printf '0\n'
			;;
	esac
}
docker() {
	case "$3" in
		'{{.State.Status}}')
			if [[ "$scenario" == restarting ]]; then
				printf 'restarting\n'
			else
				printf 'running\n'
			fi
			;;
		'{{.Config.Image}}') printf '%s\n' "$event_service_image" ;;
	esac
}
seq() { printf '1\n'; }
sleep() {
	if [[ "$scenario" == poll-abort ]]; then
		return 9
	fi
}
trap 'place_enrichment_failure_cleanup' ERR
trap 'place_enrichment_exit_cleanup "$?"' EXIT
if [[ "$scenario" == poll-abort ]]; then
	reconcile_place_enrichment_worker /release
	exit 99
fi
set +e
reconcile_place_enrichment_worker /release
status=$?
set -e
exit "$status"
`}`,
		);
		for (const scenario of ["up-fail", "restarting", "stale", "poll-abort"]) {
			const log = join(directory, `${scenario}.log`);
			writeFileSync(log, "");
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, scenario, log],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			expect(result.status, `${scenario}: ${result.stderr}`).not.toBe(0);
			const calls = readFileSync(log, "utf8");
			expect(
				calls.match(/rm --stop --force place-enrichment-worker/g)?.length,
			).toBe(2);
			expect(
				calls.match(
					/DELETE FROM place_enrichment_worker_health WHERE singleton/g,
				)?.length,
			).toBe(2);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("place-enrichment final gate rejects non-current runtime state", () => {
	const runtimeFunctions = hostDeploy.slice(
		hostDeploy.indexOf("release_supports_place_enrichment()"),
		hostDeploy.indexOf("\nverify_service_image_references()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-enrichment-final-"));
	try {
		const script = join(directory, "enrichment-final.sh");
		writeFileSync(
			script,
			`${runtimeFunctions}
${String.raw`
set -Eeuo pipefail
scenario=$1
place_enrichment_enabled=true
if [[ "$scenario" == disabled-stopped ]]; then
	place_enrichment_enabled=false
fi
event_service_image=event-service@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
compose_command() {
	case "$*" in
		*" ps -q --all place-enrichment-worker"*)
			if [[ "$scenario" == disabled-stopped ]]; then
				printf 'stopped-worker-container\n'
			fi
			;;
		*" ps -q place-enrichment-worker"*) printf 'worker-container\n' ;;
		*"SELECT count(*) FROM place_enrichment_worker_health"*)
			if [[ "$scenario" == stale ]]; then
				printf '0\n'
			else
				printf '1\n'
			fi
			;;
	esac
}
docker() {
	case "$3" in
		'{{.State.Status}}')
			case "$scenario" in
				stopped) printf 'exited\n' ;;
				restarting) printf 'restarting\n' ;;
				*) printf 'running\n' ;;
			esac
			;;
		'{{.Config.Image}}')
			if [[ "$scenario" == wrong-image ]]; then
				printf 'different@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n'
			else
				printf '%s\n' "$event_service_image"
			fi
			;;
	esac
}
verify_place_enrichment_release_state \
	/release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`}`,
		);
		for (const [scenario, expectedStatus] of [
			["healthy", 0],
			["stopped", 1],
			["restarting", 1],
			["wrong-image", 1],
			["stale", 1],
			["disabled-stopped", 1],
		] as const) {
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, scenario],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			expect(result.status, `${scenario}: ${result.stderr}`).toBe(
				expectedStatus,
			);
		}
		const recordRelease = hostDeploy.slice(
			hostDeploy.indexOf("record_release()"),
			hostDeploy.indexOf("\nactivate_release_state()"),
		);
		const recordScript = join(directory, "enrichment-record.sh");
		writeFileSync(
			recordScript,
			`${runtimeFunctions}
${recordRelease}
${String.raw`
set -Eeuo pipefail
scenario=$1
root=$2
target_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
release_dir="$root/releases/$target_sha"
releases_dir="$root/releases"
records_dir="$root/records"
mkdir -p "$release_dir/infra/postgres" "$records_dir"
touch "$release_dir/infra/postgres/grant-runtime.sql"
database_lineage_id=
target_manifest_sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
image_distribution_override_sha=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
api_gateway_image=api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
user_service_image=user@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
event_service_image=event@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
infra_image=infra@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
rate_limit_redis_image=redis@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
web_image=web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
place_enrichment_enabled=true
place_enrichment_feature_state=enabled-worker-healthy
if [[ "$scenario" == disabled-stopped ]]; then
	place_enrichment_enabled=false
	place_enrichment_feature_state=disabled-no-provider-worker
fi
runtime_grant_sha() { printf '%064d\n' 0; }
database_contract_sha() { printf '%064d\n' 0; }
runtime_infrastructure_contract_sha() { printf '%064d\n' 0; }
compose_command() {
	case "$*" in
		*" ps -q --all place-enrichment-worker"*)
			if [[ "$scenario" == disabled-stopped ]]; then
				printf 'stopped-worker-container\n'
			fi
			;;
		*" ps -q place-enrichment-worker"*) printf 'worker-container\n' ;;
		*"SELECT count(*) FROM place_enrichment_worker_health"*)
			printf '0\n'
			;;
	esac
}
docker() {
	if [[ "$1" == image ]]; then
		printf 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n'
		return
	fi
	case "$3" in
		'{{.State.Status}}')
			if [[ "$scenario" == stopped ]]; then
				printf 'exited\n'
			else
				printf 'running\n'
			fi
			;;
		'{{.Config.Image}}') printf '%s\n' "$event_service_image" ;;
	esac
}
if output=$(record_release deploy "" "$target_sha"); then
	echo "Non-current worker unexpectedly produced a release record" >&2
	exit 1
fi
[[ -z "$output" ]]
[[ -z $(find "$records_dir" -type f -print -quit) ]]
`}`,
		);
		for (const scenario of ["stopped", "stale", "disabled-stopped"]) {
			const result = spawnSync(
				"node",
				[
					"-e",
					nativeSpawn,
					"/bin/bash",
					recordScript,
					scenario,
					join(directory, scenario),
				],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			expect(result.status, `${scenario}: ${result.stderr}`).toBe(0);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("place-enrichment late release failures trigger armed cleanup", () => {
	const failureHelpers = hostDeploy.slice(
		hostDeploy.indexOf("arm_place_enrichment_failure_cleanup()"),
		hostDeploy.indexOf("\nplace_enrichment_runtime_is_current()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-enrichment-late-"));
	try {
		const script = join(directory, "enrichment-late.sh");
		writeFileSync(
			script,
			`${failureHelpers}
${String.raw`
set -Eeuo pipefail
scenario=$1
log=$2
place_enrichment_enabled=true
place_enrichment_cleanup_armed=false
place_enrichment_cleanup_release_dir=
place_enrichment_cleanup_running=false
cleanup_place_enrichment_worker() { printf 'cleanup\n' >>"$log"; }
trap 'place_enrichment_failure_cleanup' ERR
trap 'place_enrichment_exit_cleanup "$?"' EXIT
arm_place_enrichment_failure_cleanup /release
case "$scenario" in
	smoke)
		smoke_failure() { return 3; }
		smoke_failure
		;;
	image)
		image_failure() { exit 4; }
		image_failure
		;;
	record)
		record_failure() { return 5; }
		record=$(record_failure)
		;;
	success)
		disarm_place_enrichment_failure_cleanup
		;;
esac
`}`,
		);
		for (const scenario of ["smoke", "image", "record"]) {
			const log = join(directory, `${scenario}.log`);
			writeFileSync(log, "");
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, scenario, log],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			expect(result.status, `${scenario}: ${result.stderr}`).not.toBe(0);
			expect(readFileSync(log, "utf8")).toContain("cleanup\n");
		}
		const successLog = join(directory, "success.log");
		writeFileSync(successLog, "");
		const success = spawnSync(
			"node",
			["-e", nativeSpawn, "/bin/bash", script, "success", successLog],
			{
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
			},
		);
		expect(success.status, success.stderr).toBe(0);
		expect(readFileSync(successLog, "utf8")).toBe("");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("host release active record lookup survives strict shell", () => {
	const activeRecordPath = hostDeploy.slice(
		hostDeploy.indexOf("active_record_path()"),
		hostDeploy.indexOf("\nvalidate_record()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-strict-shell-"));
	try {
		const record = join(directory, "current.record");
		const script = join(directory, "strict-shell.sh");
		writeFileSync(record, "record-ok\n");
		writeFileSync(
			script,
			`${activeRecordPath}
set -Eeuo pipefail
records_dir=$1
current_record_file=$2
active_record_path aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
`,
		);
		const result = spawnSync(
			"node",
			["-e", nativeSpawn, "/bin/bash", script, directory, record],
			{
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
			},
		);
		expect(result.status, result.stderr).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("place import retries only transient source failures on official failover", () => {
	const runPlaceImport = hostDeploy.slice(
		hostDeploy.indexOf("run_place_import()"),
		hostDeploy.indexOf("\nwait_for_service()"),
	);
	const directory = mkdtempSync(join(tmpdir(), "crew-place-import-"));
	try {
		const script = join(directory, "place-import.sh");
		writeFileSync(
			script,
			`${runPlaceImport}
set -Eeuo pipefail
scenario=$1
log=$2
run_job() {
	printf 'primary\n' >>"$log"
	case "$scenario" in
		primary-ok) return 0 ;;
		primary-hard) return 2 ;;
		*) return 75 ;;
	esac
}
compose_command() {
	printf '%s\n' "$*" >>"$log"
	[[ "$scenario" != fallback-fail ]] || return 75
}
run_place_import /release
`,
		);
		for (const [scenario, expectedStatus, fallback] of [
			["primary-ok", 0, false],
			["primary-hard", 2, false],
			["fallback-ok", 0, true],
			["fallback-fail", 75, true],
		] as const) {
			const log = join(directory, `${scenario}.log`);
			writeFileSync(log, "");
			const result = spawnSync(
				"node",
				["-e", nativeSpawn, "/bin/bash", script, scenario, log],
				{
					encoding: "utf8",
					env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
				},
			);
			expect(result.status, `${scenario}: ${result.stderr}`).toBe(
				expectedStatus,
			);
			const calls = readFileSync(log, "utf8");
			expect(calls.includes("https://z.overpass-api.de/api/interpreter")).toBe(
				fallback,
			);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("public Caddy routes only the web and canonical Gateway surfaces", () => {
	expect(caddy).toContain("crew-haus.com, www.crew-haus.com");
	expect(caddy).toContain("staging.crew-haus.com");
	expect(caddy).toContain(
		"@gateway path /core/* /docs /docs/* /internal/live /internal/ready",
	);
	expect(caddy).toContain(
		"@apple_association path /.well-known/apple-app-site-association",
	);
	expect(caddy).toContain(
		"handle @apple_association {\n\t\theader Content-Type application/json\n\t\treverse_proxy 127.0.0.1:8080\n\t}",
	);
	expect(caddy).toContain(
		"@unverified_android_association path /.well-known/assetlinks.json",
	);
	expect(caddy).toContain(
		"handle @unverified_android_association {\n\t\trespond 404\n\t}",
	);
	expect(appleAssociation.applinks.details[0]?.appIDs).toEqual([
		"WFSHGY54TA.app.crew.next",
	]);
	const canonicalAppLinkPaths = [
		"/join/*",
		"/auth/redeem",
		"/events",
		"/events/*",
		"/feedback/*",
	];
	expect(appleAssociation.applinks.details[0]?.paths).toEqual(
		canonicalAppLinkPaths,
	);
	expect(appleAssociation.applinks.details[0]?.components).toEqual(
		canonicalAppLinkPaths.map((path) => ({ "/": path })),
	);
	expect(androidAssociationExists).toBe(false);
	expect(caddy).toContain("reverse_proxy 127.0.0.1:3000");
	expect(caddy).toContain("reverse_proxy 127.0.0.1:8080");
	expect(caddy).toContain("Strict-Transport-Security");
	expect(webDockerfile).toContain("WORKDIR /app/apps/web\nRUN bun run build");
	expect(services.web?.cap_add).toEqual(["NET_BIND_SERVICE"]);
	expect(hostDeploy).toContain("https://crew-haus.com/");
});

test("public Gateway trusts only the fixed host-side Caddy peer", () => {
	expect(overlay.networks?.default).toEqual({
		ipam: {
			config: [
				{
					subnet: "172.30.0.0/24",
					ip_range: "172.30.0.128/25",
					gateway: "172.30.0.1",
				},
			],
		},
	});
	expect(
		(services["api-gateway"]?.environment as Record<string, unknown>)
			?.TRUSTED_PROXY_IPS,
	).toBe("172.30.0.1");
	expect(services["api-gateway"]?.networks).toEqual({
		default: { ipv4_address: "172.30.0.10" },
	});
	expect(
		(services["user-api"]?.environment as Record<string, unknown>)
			?.TRUSTED_GATEWAY_IP,
	).toBe("172.30.0.10");
	expect(caddy).toContain("reverse_proxy 127.0.0.1:3000");
});
