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
	expect(overlaySource).not.toContain("staging-fixture-model");
});

test("private production dependencies terminate TLS at the isolated proxy", () => {
	expect(String(services["internal-tls"]?.image)).toBe(
		"haproxy:3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb",
	);
	expect(services["internal-tls"]?.ports).toEqual(["0.0.0.0:8444:8444"]);
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
	expect(hostDeploy).toContain("checkout --quiet --detach");
	expect(hostDeploy).toContain("status --short");
	expect(hostDeploy).toContain("--file apps/web/Dockerfile");
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
	expect(hostDeploy).toContain(`"crew-next-web:\${target_sha}"`);
	expect(hostDeploy).toContain('\\"provider-sink\\":');
	expect(hostDeploy).toContain('\\"rate-limit-redis\\":');
	expect(hostDeploy).toContain('\\"internal-tls\\":');
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
