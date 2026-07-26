import { expect, test } from "bun:test";

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
	).toBe("false");
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
	expect(hostDeploy).toContain(`--file "\${digest_override_file}"`);
	expect(hostDeploy.match(/pull_policy: never/g)?.length).toBe(17);
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
	expect(hostDeploy).not.toContain("docker compose down");
	expect(hostDeploy).not.toContain("docker volume rm");
	expect(hostDeploy).not.toContain("DROP DATABASE");
	expect(hostDeploy).toContain("databaseReleaseId");
	expect(hostDeploy).toContain("database_release_dir=");
	expect(hostDeploy).toContain("database_contract_sha()");
	expect(hostDeploy).toContain("runtime_infrastructure_contract_sha()");
	expect(hostDeploy).toContain(
		'"kind": "identical-database-and-runtime-contract"',
	);
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
		'"features": {"placeEnrichment": "disabled-no-provider-worker"}',
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
	expect(hostDeploy).toContain('"smoke"');
	expect(hostDeploy).toContain('"feedback-attachment-e2e"');
	expect(hostDeploy).toContain("auth_run_id=$(openssl rand -hex 12)");
	expect(hostDeploy).toContain(`-e CREW_FIXTURE_AUTH_RUN_ID="\${auth_run_id}"`);
	expect(hostDeploy).toContain("-e CREW_FIXTURE_ATTACHMENT_E2E=1");
	expect(hostDeploy).toContain("-e CREW_FIXTURE_SCENARIO=team-event");
});

test("staging release publishes six digests behind the reviewed environment", () => {
	const workflow = Bun.YAML.parse(releaseWorkflow) as {
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
	for (const action of [
		"actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
		"docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9",
		"docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f",
		"docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8",
		"actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
		"actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
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
	expect(releaseWorkflow).toContain("if: inputs.deploy");
	expect(releaseWorkflow).toContain("reuse_stored_manifest:");
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
		`[[ "\${target_sha}" == "\${controller_sha}" ]]`,
	);
	expect(githubDeploy).toContain("merge-base --is-ancestor");
	expect(githubDeploy).toContain(
		`\${controller_sha}:infra/staging/host-release.sh`,
	);
	expect(githubDeploy).toContain("env -i");
	expect(githubDeploy).toContain("CREW_IMAGE_MANIFEST_SOURCE");
	expect(githubDeploy).toContain(`manifest_dir="\${shared_dir}/manifests"`);
	expect(githubDeploy).not.toContain("/shared/environment");
	expect(githubDeploy).not.toContain("eval ");
	expect(githubDeploy).not.toContain("StrictHostKeyChecking=no");
});

test("public Caddy routes only the web and canonical Gateway surfaces", () => {
	expect(caddy).toContain("crew-haus.com, www.crew-haus.com");
	expect(caddy).toContain("staging.crew-haus.com");
	expect(caddy).toContain(
		"@gateway path /core/* /docs /docs/* /internal/live /internal/ready",
	);
	expect(caddy).toContain(
		"@unverified_associations path /.well-known/apple-app-site-association /.well-known/assetlinks.json",
	);
	expect(caddy).toContain(
		"handle @unverified_associations {\n\t\trespond 404\n\t}",
	);
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
