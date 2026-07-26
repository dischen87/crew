import { expect, test } from "bun:test";

const root = new URL("../", import.meta.url);
const overlaySource = await Bun.file(
	new URL("infra/staging/compose.staging.yaml", root),
).text();
const overlay = Bun.YAML.parse(overlaySource) as {
	name?: unknown;
	services?: Record<string, Record<string, unknown>>;
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
	expect(overlaySource).not.toContain("staging-fixture-model");
});

test("private production dependencies terminate TLS at the isolated proxy", () => {
	expect(String(services["internal-tls"]?.image)).toBe(
		"haproxy:3.4.2-alpine@sha256:0878b11eb64c433be1b0f578a584b8aca12f6caaa64c8f239b8b556c0dd5eeeb",
	);
	expect(services["internal-tls"]?.ports).toEqual(["0.0.0.0:8444:8444"]);
	for (const port of ["6379", "8443", "8444", "8445", "8446"]) {
		expect(haproxy).toContain(`bind :${port} ssl crt`);
	}
	expect(overlaySource).toContain(
		"rediss://crew_gateway:${REDIS_GATEWAY_PASSWORD:",
	);
	expect(overlaySource).toContain(
		"EVENT_OBJECT_STORE_ENDPOINT: https://staging.crew-haus.com:8444",
	);
	expect(overlaySource).toContain(
		"PLACE_SEARCH_TYPESENSE_URL: https://staging.crew-haus.com:8445",
	);
	expect(hostDeploy).toMatch(
		/printf 'TYPESENSE_API_KEY=%s\\n' "\$\{typesense_key\}"/,
	);
	expect(hostDeploy).toMatch(
		/printf 'TYPESENSE_SEARCH_API_KEY=%s\\n' "\$\{typesense_key\}"/,
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
	expect(hostDeploy).toContain('"kind": "identical-database-contract"');
	expect(hostDeploy).toContain("validate_current_state");
	expect(hostDeploy).toContain("validate_compatibility_proof");
	expect(hostDeploy).toContain(
		"Forward deploy changes the database contract; richer rollback evidence is required",
	);
	expect(hostDeploy).toContain(
		"Rollback target is not compatible with the active database contract",
	);
	expect(hostDeploy).toContain("databaseCompatibilitySha256");
	expect(hostDeploy.lastIndexOf("\tvalidate_compatibility_proof")).toBeLessThan(
		hostDeploy.lastIndexOf(`\ninstall_caddy "\${release_dir}"`),
	);
	expect(hostDeploy).toContain(
		'"features": {"placeEnrichment": "disabled-no-provider-worker"}',
	);
	expect(hostDeploy).toContain("infra/postgres/grant-runtime.sql");
	expect(hostDeploy).toContain(`"crew-next-web:\${target_sha}"`);
	expect(hostDeploy).toContain('"public-web"');
	expect(hostDeploy).toContain('"smoke"');
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
	expect(caddy).toContain("respond @unverified_associations 404");
	expect(caddy).toContain("reverse_proxy 127.0.0.1:3000");
	expect(caddy).toContain("reverse_proxy 127.0.0.1:8080");
	expect(caddy).toContain("Strict-Transport-Security");
	expect(webDockerfile).toContain("WORKDIR /app/apps/web\nRUN bun run build");
	expect(hostDeploy).toContain("https://crew-haus.com/");
});
