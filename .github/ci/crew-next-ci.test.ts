import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

const repositoryRoot = new URL("../../", import.meta.url);
const workflowUrl = new URL(
	".github/workflows/crew-next-ci.yml",
	repositoryRoot,
);
const workflowSource = await Bun.file(workflowUrl).text();
const dockerIgnoreSource = await Bun.file(
	new URL(".dockerignore", repositoryRoot),
).text();
const composeSource = await Bun.file(
	new URL("compose.yaml", repositoryRoot),
).text();
const platformDockerfileSource = await Bun.file(
	new URL("infra/Dockerfile", repositoryRoot),
).text();
const runtimeGrantSource = await Bun.file(
	new URL("infra/postgres/grant-runtime.sql", repositoryRoot),
).text();
const attachmentApiGrant =
	"GRANT SELECT, INSERT ON TABLE event_attachments TO crew_event_api;";
const attachmentCleanupFunctionRevoke = `REVOKE EXECUTE ON FUNCTION delete_claimed_feedback_attachment(
	TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM
	PUBLIC, crew_event_api, crew_event_notification_worker,
	crew_event_recap_retention_worker;`;
const checkoutSha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupBunSha = "0c5077e51419868618aeaa5fe8019c62421857d6";
const githubShaExpression = ["$", "{{ github.sha }}"].join("");
const postgresImage =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const redisImage =
	"redis:8.8.0-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005";
const bunImage =
	"oven/bun:1.3.9-alpine@sha256:9028ee7a60a04777190f0c3129ce49c73384d3fc918f3e5c75f5af188e431981";
const minioImage =
	"quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";
const minioMcImage =
	"minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727";
const redisDockerfile = await Bun.file(
	new URL("infra/redis/Dockerfile", repositoryRoot),
).text();
const serviceImages = {
	"api-gateway": "@crew/api-gateway",
	"user-service": "@crew/user-service",
	"event-service": "@crew/event-service",
} as const;
const serviceDockerfiles = Object.fromEntries(
	await Promise.all(
		Object.keys(serviceImages).map(async (service) => [
			service,
			await Bun.file(
				new URL(`services/${service}/Dockerfile`, repositoryRoot),
			).text(),
		]),
	),
);
const databases = {
	USER_DATABASE_URL: "crew_next_user_ci",
	EVENT_DATABASE_URL: "crew_next_event_ci",
	EVENT_TEST_DATABASE_URL: "crew_next_event_ci",
	EVENT_ROOT_LIST_TEST_DATABASE_URL: "crew_next_event_ci",
	EVENT_INVITATION_LIST_TEST_DATABASE_URL: "crew_next_event_ci",
	PLACE_CANDIDATE_TEST_DATABASE_URL: "crew_next_place_ci",
	PLACE_ENRICHMENT_TEST_DATABASE_URL: "crew_next_place_ci",
	PLACE_ENRICHMENT_API_TEST_DATABASE_URL: "crew_next_place_ci",
	GOLF_DISCOVERY_TEST_DATABASE_URL: "crew_next_place_ci",
	SECURITY_USER_DATABASE_URL: "crew_next_security_user_ci",
	SECURITY_EVENT_DATABASE_URL: "crew_next_security_event_ci",
	EVENT_USER_COMPOSITION_USER_DATABASE_URL:
		"crew_event_user_composition_user_test",
	EVENT_USER_COMPOSITION_EVENT_DATABASE_URL:
		"crew_event_user_composition_event_test",
} as const;

describe("Crew Next GitHub Actions workflow", () => {
	test("pins runtimes, fails closed and contains no deployment path", () => {
		validateWorkflow(workflowSource);
	});

	test("turns required command, environment and fail-closed drift red", () => {
		for (const [needle, replacement] of [
			["          bun run typecheck\n", ""],
			[
				"          docker build --file services/api-gateway/Dockerfile",
				"          true #",
			],
			["      EVENT_TEST_DATABASE_URL:", "      RENAMED_EVENT_DATABASE_URL:"],
			["          set -euo pipefail", "          set +e"],
			["  contents: read", "  contents: write"],
			[
				"      - name: Check out repository\n",
				"      - name: Unpinned action\n        uses: actions/cache@v4\n\n      - name: Check out repository\n",
			],
			[checkoutSha, "f".repeat(40)],
			[postgresImage, "postgres:latest"],
			[redisImage, "redis:latest"],
			[minioImage, "quay.io/minio/minio:latest"],
			[minioMcImage, "minio/mc:latest"],
			["          docker restart crew-rate-limit-test\n", "          true #\n"],
			[
				'          MINIO_PROVIDER_TEST_METRICS_TOKEN="$metrics_token" bun test',
				"          true #",
			],
			["          docker compose config --quiet\n", "          true #\n"],
			[
				'            test "$event_attachment_acl" = "t|t|f|f|f|f|f|f|f|t|f|f|f|f|f|f|f|t|f|f|f"\n',
				"            true # removed attachment ACL oracle\n",
			],
			[
				'            test "$runtime_default_acl_count" -eq 0\n',
				"            true # removed default ACL oracle\n",
			],
			[
				"          docker compose up --wait --wait-timeout 180\n",
				"          true #\n",
			],
		] as const) {
			const drifted = workflowSource.replace(needle, replacement);
			expect(drifted).not.toBe(workflowSource);
			expect(() => validateWorkflow(drifted)).toThrow();
		}
	});

	test("rejects duplicate migration prefixes before any migration runs", async () => {
		for (const directory of [
			"services/user-service/migrations",
			"services/event-service/migrations",
		]) {
			const files = await Array.fromAsync(
				new Bun.Glob("*.sql").scan({
					cwd: decodeURIComponent(
						new URL(`${directory}/`, repositoryRoot).pathname,
					),
					onlyFiles: true,
				}),
			);
			expect(files.length).toBeGreaterThan(0);
			const prefixes = files.map((file) => {
				const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
				expect(match).not.toBeNull();
				return match?.[1];
			});
			expect(new Set(prefixes).size).toBe(prefixes.length);
		}
	});

	test("builds every Crew Next service from a version-pinned non-root image", () => {
		for (const [service, workspace] of Object.entries(serviceImages)) {
			const dockerfile = serviceDockerfiles[service];
			expect(dockerfile).toBeDefined();
			expect(dockerfile).not.toMatch(/latest/i);
			expect(dockerfile?.match(/^FROM .+$/gm)).toEqual([
				`FROM ${bunImage} AS deps`,
				`FROM ${bunImage}`,
			]);
			expect(dockerfile?.match(/^RUN .+$/gm)).toContain(
				`RUN bun install --production --frozen-lockfile --filter ${workspace}`,
			);
			expect(dockerfile?.match(/^USER .+$/gm)).toEqual(["USER bun"]);
			expect(workflowSource).toContain(
				`docker build --file services/${service}/Dockerfile --tag crew-next-${service}:${githubShaExpression} .`,
			);
		}
	});

	test("builds the pinned non-root Redis boundary image", () => {
		expect(redisDockerfile).toContain(`FROM ${redisImage}`);
		expect(redisDockerfile).toContain("USER redis");
		expect(workflowSource).toContain(
			`docker build --file infra/redis/Dockerfile --tag crew-next-rate-limit-redis:${githubShaExpression} .`,
		);
	});

	test("keeps service build inputs while excluding local and generated context", () => {
		const rules = dockerIgnoreSource
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"));
		expect(rules.every((rule) => !rule.startsWith("!"))).toBe(true);
		for (const requiredRule of [
			".git/**",
			".beads/**",
			"**/node_modules/**",
			"**/build/**",
			"**/Pods/**",
			"**/.gradle/**",
			"**/.cxx/**",
			"**/evidence/**",
			"docs/**",
			"**/.env.*",
			"**/.idea/**",
			"**/.vscode/**",
			"**/.DS_Store",
		]) {
			expect(rules).toContain(requiredRule);
		}
		const ignored = (path: string) =>
			rules.some((rule) => new Bun.Glob(rule).match(path));
		for (const excluded of [
			".git/config",
			".beads/beads.db",
			"node_modules/react/package.json",
			"services/api-gateway/node_modules/hono/package.json",
			"apps/mobile/android/app/build/outputs/app.apk",
			"apps/mobile/ios/Pods/Manifest.lock",
			"apps/mobile/evidence/screen.png",
			"docs/local-development.md",
			"services/event-service/.env.local",
			".idea/workspace.xml",
			".DS_Store",
		]) {
			expect(ignored(excluded)).toBe(true);
		}
		for (const dockerfile of Object.values(serviceDockerfiles)) {
			for (const source of dockerContextSources(dockerfile)) {
				expect(existsSync(new URL(source, repositoryRoot))).toBe(true);
				expect(ignored(source)).toBe(false);
			}
		}
	});

	test("pins external Compose images and keeps fixture bootstrap API-only", () => {
		expect(composeSource).not.toMatch(/\blatest\b/i);
		expect(platformDockerfileSource).toContain(
			"COPY apps/mobile/package.json ./apps/mobile/package.json",
		);
		const compose = object(Bun.YAML.parse(composeSource), "Compose document");
		const services = object(compose.services, "Compose services");
		for (const [name, value] of Object.entries(services)) {
			const service = object(value, `${name} service`);
			if ("image" in service && !("build" in service)) {
				expect(string(service.image, `${name} image`)).toMatch(
					/:[^@\s]+@sha256:[0-9a-f]{64}$/,
				);
			}
		}
		const fixture = object(services["fixture-bootstrap"], "fixture service");
		expect(fixture.command).toEqual(["bun", "infra/bootstrap-fixture.ts"]);
		expect(
			Object.keys(object(fixture.environment, "fixture environment")),
		).not.toContainEqual(expect.stringMatching(/DATABASE|POSTGRES|SQL/));
	});

	test("grants each runtime worker the database operations it executes", () => {
		validateRuntimeGrants(runtimeGrantSource);
		for (const drifted of [
			runtimeGrantSource.replace(
				"AND tablename NOT IN ('event_schema_migrations', 'event_attachments')",
				"AND tablename <> 'event_schema_migrations'",
			),
			runtimeGrantSource.replace(
				attachmentCleanupFunctionRevoke,
				"-- missing sensitive function revoke",
			),
			runtimeGrantSource.replace(
				`${attachmentCleanupFunctionRevoke}\nREVOKE ALL ON TABLE event_recap_external_retention_state FROM crew_event_api;`,
				`REVOKE ALL ON TABLE event_recap_external_retention_state FROM crew_event_api;\n${attachmentCleanupFunctionRevoke}`,
			),
			`${runtimeGrantSource}\nGRANT DELETE ON event_attachments TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT TRUNCATE ON event_attachments TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT ALL PRIVILEGES ON TABLE event_attachments TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT UPDATE ON TABLE public."event_attachments" TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT DELETE ON TABLE "public"."event_attachments" TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT ALL ON ALL TABLES IN SCHEMA public TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT INSERT ON ALL TABLES IN SCHEMA public TO crew_event_attachment_worker;\n`,
			`${runtimeGrantSource}\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO crew_event_api;\n`,
			`${runtimeGrantSource}\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC;\n`,
			`${runtimeGrantSource}\nGRANT EXECUTE ON FUNCTION public.delete_claimed_feedback_attachment(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO crew_event_api;\n`,
			`${runtimeGrantSource}\nGRANT ALL ON ALL ROUTINES IN SCHEMA public TO crew_event_api;\n`,
			`${runtimeGrantSource}\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO crew_event_api;\n`,
			`${runtimeGrantSource}\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;\n`,
			`${runtimeGrantSource}\nSELECT format(\n\t'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO crew_event_api',\n\tschemaname,\n\ttablename\n)\nFROM pg_tables\nWHERE tablename = 'event_attachments'\n\\gexec\n`,
			runtimeGrantSource.replace(
				"GRANT SELECT ON TABLE event_attachments\nTO crew_event_attachment_worker;",
				"GRANT SELECT, DELETE ON TABLE event_attachments\nTO crew_event_attachment_worker;",
			),
			runtimeGrantSource.replace(
				"GRANT SELECT ON TABLE event_attachments\nTO crew_event_attachment_worker;",
				"GRANT SELECT, TRUNCATE ON TABLE event_attachments\nTO crew_event_attachment_worker;",
			),
		]) {
			expect(drifted).not.toBe(runtimeGrantSource);
			expect(() => validateRuntimeGrants(drifted)).toThrow();
		}
	});
});

function validateRuntimeGrants(source: string) {
	const blanketEventApiGrant =
		"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO crew_event_api";
	const dynamicApiGrantFormats = Array.from(
		source.matchAll(/'(\s*GRANT\b[^']*\bcrew_event_[a-z_]+\b[^']*)'/gi),
		(match) => normalizeSql(match[1] as string),
	);
	expect(dynamicApiGrantFormats).toEqual([normalizeSql(blanketEventApiGrant)]);
	expect(source).toContain(
		"AND tablename NOT IN ('event_schema_migrations', 'event_attachments')",
	);
	const statements = privilegeStatements(source);
	const runtimeStatements = statements.filter((statement) =>
		/\bto\b[^;]*\bcrew_event_(?:api|attachment_worker|notification_worker|recap_retention_worker)\b/.test(
			statement,
		),
	);
	const apiStatements = statements.filter((statement) =>
		/\bto\b[^;]*\bcrew_event_api\b/.test(statement),
	);
	expect(
		runtimeStatements.filter((statement) =>
			/\bon all tables in schema\b/.test(statement),
		),
	).toEqual([]);
	expect(
		statements.filter(
			(statement) =>
				statement.startsWith("alter default privileges ") &&
				/\bon (?:tables|functions|routines)\b/.test(statement) &&
				/\bto\b[^;]*(?:\bpublic\b|\bcrew_event_(?:api|attachment_worker|notification_worker|recap_retention_worker)\b)/.test(
					statement,
				),
		),
	).toEqual([]);
	const normalizedAttachmentApiGrant = normalizeSql(attachmentApiGrant);
	expect(
		apiStatements.filter((statement) =>
			statement.includes("event_attachments"),
		),
	).toEqual([normalizedAttachmentApiGrant]);

	const grantAllFunctions =
		"grant execute on all functions in schema public to crew_event_api;";
	const grantAllFunctionIndexes = statements.flatMap((statement, index) =>
		statement === grantAllFunctions ? [index] : [],
	);
	expect(grantAllFunctionIndexes).toHaveLength(1);
	expect(
		runtimeStatements.filter((statement) =>
			/\bon all (?:functions|routines) in schema\b/.test(statement),
		),
	).toEqual([grantAllFunctions]);
	const grantAllFunctionsIndex = grantAllFunctionIndexes[0] as number;
	expect(statements[grantAllFunctionsIndex + 1]).toBe(
		normalizeSql(attachmentCleanupFunctionRevoke),
	);
	const sensitiveFunctionGrants = statements.filter(
		(statement) =>
			statement.startsWith("grant ") &&
			statement.includes("delete_claimed_feedback_attachment"),
	);
	expect(sensitiveFunctionGrants).toEqual([
		"grant execute on function delete_claimed_feedback_attachment(text,text,text,text,text,bigint)to crew_event_attachment_worker;",
	]);
	for (const required of [
		"GRANT SELECT, UPDATE, DELETE ON TABLE user_delivery_outbox",
		"GRANT SELECT, UPDATE, DELETE ON TABLE user_push_outbox",
		"event_attachment_cleanup_jobs,\n\tevent_attachment_uploads",
		"GRANT SELECT ON TABLE event_attachments",
		"GRANT SELECT ON TABLE event_feedback_attachments",
		"GRANT EXECUTE ON FUNCTION delete_claimed_feedback_attachment(",
		"GRANT SELECT, UPDATE, DELETE ON TABLE event_notification_outbox",
		"GRANT UPDATE (root_event_id) ON TABLE event_roots",
	]) {
		expect(source).toContain(required);
	}
	expect(
		statements.filter(
			(statement) =>
				statement.includes("event_attachments") &&
				/\bto\b[^;]*\bcrew_event_attachment_worker\b/.test(statement),
		),
	).toEqual([
		"grant select on table event_attachments to crew_event_attachment_worker;",
	]);
	expect(statements).not.toEqual(
		expect.arrayContaining([
			expect.stringMatching(
				/^grant\b[^;]*\binsert\b[^;]*\bto\b[^;]*\bcrew_(?:user|event)_[a-z_]+_worker\b/,
			),
		]),
	);
}

function privilegeStatements(source: string) {
	return Array.from(
		source.matchAll(
			/^[\t ]*(?:GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b[\s\S]*?;/gim,
		),
		(match) => normalizeSql(match[0]),
	);
}

function normalizeSql(statement: string) {
	return statement
		.replaceAll('"', "")
		.replace(/\s+/g, " ")
		.replace(/\s*([(),;.])\s*/g, "$1")
		.trim()
		.toLowerCase();
}

function validateWorkflow(source: string) {
	expect(source).not.toMatch(/latest/i);
	expect(source).not.toContain("continue-on-error");
	expect(source).not.toMatch(/\|\|\s*true|;\s*true|set \+e/);
	expect(source).not.toMatch(
		/\b(?:deploy|ssh|scp|kubectl|helm|git push|docker (?:stack|push))\b/i,
	);

	const workflow = object(Bun.YAML.parse(source), "workflow");
	expect(object(workflow.permissions, "permissions")).toEqual({
		contents: "read",
	});
	const jobs = object(workflow.jobs, "jobs");
	const job = object(jobs["crew-next"], "crew-next job");
	expect(job["runs-on"]).toBe("ubuntu-24.04");
	expect(job["timeout-minutes"]).toBe(30);
	const services = object(job.services, "services");
	const postgres = object(services.postgres, "PostgreSQL service");
	expect(postgres.image).toBe(postgresImage);

	const steps = array(job.steps, "steps").map((value, index) =>
		object(value, `step ${index}`),
	);
	const checkout = requiredStep(steps, "Check out repository");
	expect(checkout.uses).toBe(`actions/checkout@${checkoutSha}`);
	expect(object(checkout.with, "checkout inputs")["fetch-depth"]).toBe(0);
	const setupBun = requiredStep(steps, "Set up Bun 1.3.9");
	expect(setupBun.uses).toBe(`oven-sh/setup-bun@${setupBunSha}`);
	expect(object(setupBun.with, "Bun inputs")["bun-version"]).toBe("1.3.9");
	for (const step of steps) {
		if ("uses" in step) {
			expect(string(step.uses, "action")).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
		}
		if ("run" in step) {
			const run = string(step.run, "run command");
			expect(run.trimStart().startsWith("set -euo pipefail\n")).toBe(true);
		}
	}

	const env = object(job.env, "job env");
	for (const [variable, expectedDatabase] of Object.entries(databases)) {
		const value = string(env[variable], variable);
		expect(databaseName(value)).toBe(expectedDatabase);
	}
	expect(env.EVENT_DATABASE_URL).toBe(env.EVENT_TEST_DATABASE_URL);
	expect(env.EVENT_ROOT_LIST_TEST_DATABASE_URL).toBe(
		env.EVENT_TEST_DATABASE_URL,
	);
	expect(env.EVENT_INVITATION_LIST_TEST_DATABASE_URL).toBe(
		env.EVENT_TEST_DATABASE_URL,
	);
	expect(env.PLACE_ENRICHMENT_TEST_DATABASE_URL).toBe(
		env.PLACE_CANDIDATE_TEST_DATABASE_URL,
	);
	expect(env.PLACE_ENRICHMENT_API_TEST_DATABASE_URL).toBe(
		env.PLACE_CANDIDATE_TEST_DATABASE_URL,
	);
	expect(env.GOLF_DISCOVERY_TEST_DATABASE_URL).toBe(
		env.PLACE_CANDIDATE_TEST_DATABASE_URL,
	);
	expect(env.SECURITY_USER_DATABASE_URL).not.toBe(env.USER_DATABASE_URL);
	expect(env.SECURITY_EVENT_DATABASE_URL).not.toBe(env.EVENT_DATABASE_URL);
	expect(env.EVENT_USER_COMPOSITION_USER_DATABASE_URL).not.toBe(
		env.EVENT_USER_COMPOSITION_EVENT_DATABASE_URL,
	);
	expect(env.REDIS_TEST_IMAGE).toBe(redisImage);
	expect(env.GATEWAY_RATE_LIMIT_TEST_REDIS_URL).toBe(
		"redis://127.0.0.1:6379/14",
	);
	expect(env.USER_RATE_LIMIT_TEST_REDIS_URL).toBe("redis://127.0.0.1:6379/15");
	expect(env.REDIS_RATE_LIMIT_BOUNDARY_TEST_ADMIN_URL).toBe(
		"redis://127.0.0.1:6379/13",
	);
	expect(env.REDIS_AOF_TEST_URL).toBe("redis://127.0.0.1:6379/12");
	expect(env.MINIO_TEST_IMAGE).toBe(minioImage);
	expect(env.MINIO_MC_TEST_IMAGE).toBe(minioMcImage);
	expect(env.MINIO_PROVIDER_TEST_ENDPOINT).toBe("http://127.0.0.1:9000");
	expect(env.MINIO_PROVIDER_TEST_BUCKET).toBe("crew-event-development");

	const startRedis = runStep(steps, "Start Redis rate-limit test store");
	expect(startRedis).toContain(
		"docker run --detach --name crew-rate-limit-test",
	);
	expect(startRedis).toContain('"$REDIS_TEST_IMAGE" redis-server');
	expect(startRedis).toContain("--appendonly yes --appendfsync always");
	expect(startRedis).toContain("--maxmemory-policy noeviction");
	const startMinio = runStep(steps, "Start pinned MinIO test store");
	expect(startMinio).toContain(
		"docker run --detach --name crew-minio-test --publish 127.0.0.1:9000:9000",
	);
	expect(startMinio).toContain("MINIO_PROMETHEUS_AUTH_TYPE=jwt");
	expect(startMinio).toContain('"$MINIO_TEST_IMAGE" server /data');

	const minioProof = runStep(steps, "Prove MinIO attachment ingress policy");
	for (const required of [
		"infra/minio/bootstrap.sh",
		"crew-quarantine-expiry-v1",
		"268435456",
		"mc admin prometheus generate local api",
		'MINIO_PROVIDER_TEST_METRICS_TOKEN="$metrics_token" bun test',
		"./infra/minio-provider.integration.test.ts",
	]) {
		expect(minioProof).toContain(required);
	}
	expect(minioProof).not.toContain("--public");

	const createDatabases = runStep(
		steps,
		"Create fresh Crew Next PostgreSQL databases",
	);
	const verifyDatabases = runStep(
		steps,
		"Verify database identities before migrations",
	);
	for (const expectedDatabase of new Set(Object.values(databases))) {
		expect(occurrences(createDatabases, expectedDatabase)).toBe(1);
		expect(verifyDatabases).toContain(`= ${expectedDatabase}`);
	}
	for (const variable of Object.keys(databases)) {
		expect(verifyDatabases).toContain(`"$${variable}"`);
	}

	expect(stepDirectory(steps, "Migrate User service database")).toBe(
		"services/user-service",
	);
	expect(commands(steps, "Migrate User service database")).toEqual([
		"bun run db:migrate",
	]);
	expect(stepDirectory(steps, "Migrate Event service database")).toBe(
		"services/event-service",
	);
	expect(commands(steps, "Migrate Event service database")).toEqual([
		"bun run db:migrate",
	]);
	expect(commands(steps, "Install frozen workspace")).toEqual([
		"bun install --frozen-lockfile",
	]);
	expect(
		commands(steps, "Validate Crew Next CI structure and migration prefixes"),
	).toEqual(["bunx biome check .github/ci", "bun test ./.github/ci"]);
	expect(commands(steps, "Check release tooling")).toEqual([
		"bash -n infra/staging/host-release.sh",
		"bunx biome check infra/staging-config.test.ts",
		"bun test infra/staging-config.test.ts",
	]);
	expect(commands(steps, "Check User service")).toEqual([
		"bun run lint",
		"bun run typecheck",
		"bun run contract:check",
		"bun test",
	]);
	expect(commands(steps, "Check Event service")).toEqual([
		"bun run lint",
		"bun run typecheck",
		"bun run contract:check",
		"bun test",
	]);
	expect(commands(steps, "Check API gateway and aggregate contract")).toEqual([
		"bun run lint",
		"bun run typecheck",
		"bun run client:check",
		"bun run contract:check",
		"bun test",
	]);
	expect(commands(steps, "Check Redis rate-limit ownership boundary")).toEqual([
		"bunx biome check infra/redis-config.test.ts infra/redis-boundary.integration.test.ts infra/redis-aof-restart.integration.test.ts",
		"bun test ./infra/redis-config.test.ts ./infra/redis-boundary.integration.test.ts",
	]);
	const restartProof = runStep(steps, "Prove Redis AOF restart continuity");
	expect(restartProof).toContain(
		"REDIS_AOF_TEST_PHASE=seed bun test ./infra/redis-aof-restart.integration.test.ts",
	);
	expect(restartProof).toContain("docker restart crew-rate-limit-test");
	expect(restartProof).toContain(
		"REDIS_AOF_TEST_PHASE=verify bun test ./infra/redis-aof-restart.integration.test.ts",
	);
	expect(
		steps.findIndex(
			(step) => step.name === "Check Redis rate-limit ownership boundary",
		),
	).toBeLessThan(
		steps.findIndex(
			(step) => step.name === "Prove Redis AOF restart continuity",
		),
	);
	expect(commands(steps, "Check product contract inventory")).toEqual([
		"bun run check:product-contracts",
	]);
	expect(stepDirectory(steps, "Check Crew web")).toBe("apps/web");
	expect(commands(steps, "Check Crew web")).toEqual(["bun run check"]);
	expect(commands(steps, "Check mobile data")).toEqual([
		"bun run lint",
		"bun run typecheck",
		"bun test",
	]);
	expect(commands(steps, "Check mobile client")).toEqual([
		"bun run generate:check",
		"bun run lint",
		"bun run typecheck",
		"bun test",
	]);
	expect(commands(steps, "Check React Native app")).toEqual([
		"bun run check:mobile-app",
	]);
	expect(commands(steps, "Build Crew Next service images")).toEqual([
		`docker build --file services/api-gateway/Dockerfile --tag crew-next-api-gateway:${githubShaExpression} .`,
		`docker build --file services/user-service/Dockerfile --tag crew-next-user-service:${githubShaExpression} .`,
		`docker build --file services/event-service/Dockerfile --tag crew-next-event-service:${githubShaExpression} .`,
		`docker build --file infra/redis/Dockerfile --tag crew-next-rate-limit-redis:${githubShaExpression} .`,
	]);

	const composeJob = object(jobs["compose-smoke"], "Compose smoke job");
	expect(composeJob["runs-on"]).toBe("ubuntu-24.04");
	expect(composeJob["timeout-minutes"]).toBe(30);
	expect(composeJob).not.toHaveProperty("environment");
	const composeSteps = array(composeJob.steps, "Compose steps").map(
		(value, index) => object(value, `Compose step ${index}`),
	);
	expect(requiredStep(composeSteps, "Check out repository").uses).toBe(
		`actions/checkout@${checkoutSha}`,
	);
	const composeSmoke = runStep(
		composeSteps,
		"Prove fresh Compose platform and API fixtures",
	);
	expect(composeSmoke.trimStart().startsWith("set -euo pipefail\n")).toBe(true);
	for (const required of [
		"docker compose config --quiet",
		"docker compose build --pull",
		"docker compose up --wait --wait-timeout 180",
		"docker compose down --volumes --remove-orphans",
		"docker volume ls --quiet --filter label=com.docker.compose.project=crew-new",
		"for auth_run_id in 000000000000000000000001 000000000000000000000002; do",
		"for scenario in golf-tour team-event; do",
		"docker compose --profile tools run --no-deps --rm \\",
		['-e CREW_FIXTURE_AUTH_RUN_ID="$', '{auth_run_id}"'].join(""),
		"-e CREW_FIXTURE_ATTACHMENT_E2E=1",
		['-e CREW_FIXTURE_SCENARIO="$', '{scenario}" fixture-bootstrap'].join(""),
		'if [ "$auth_run_id" = 000000000000000000000001 ]; then',
		"DELETE FROM user_idempotency_records",
		"DELETE FROM event_idempotency_records",
		"WHERE idempotency_key LIKE 'fixture.%'",
		'test "$expired_user_fixture_keys" -gt 0',
		'test "$expired_event_fixture_keys" -gt 0',
		"SELECT count(*) FROM user_schema_migrations",
		"SELECT count(*) FROM event_schema_migrations",
		"has_table_privilege('crew_event_api', 'event_attachments', 'UPDATE')",
		"has_table_privilege('crew_event_api', 'event_attachments', 'TRUNCATE')",
		"has_table_privilege('crew_event_api', 'event_attachments', 'MAINTAIN')",
		"has_table_privilege('crew_event_attachment_worker', 'event_attachments', 'INSERT')",
		"has_table_privilege('crew_event_attachment_worker', 'event_attachments', 'TRUNCATE')",
		"has_function_privilege('crew_event_api', 'delete_claimed_feedback_attachment(text,text,text,text,text,bigint)', 'EXECUTE')",
		'test "$event_attachment_acl" = "t|t|f|f|f|f|f|f|f|t|f|f|f|f|f|f|f|t|f|f|f"',
		"FROM pg_default_acl AS default_acl",
		"aclexplode(default_acl.defaclacl)",
		"LEFT JOIN pg_roles AS grantee",
		"WHERE expanded_acl.grantee = 0",
		'test "$runtime_default_acl_count" -eq 0',
		"http://127.0.0.1:3000/internal/ready",
		'test -z "$(git status --porcelain)"',
	]) {
		expect(composeSmoke).toContain(required);
	}
	expect(occurrences(composeSmoke, "docker compose up --wait")).toBe(2);
	expect(composeSmoke).not.toContain(
		"docker compose --profile tools run --rm -e CREW_FIXTURE_SCENARIO",
	);
	expect(composeSmoke).not.toMatch(/docker compose\s+(?:push|publish)\b/);
	expect(source).not.toContain("secrets.");
}

function requiredStep(steps: Record<string, unknown>[], name: string) {
	const step = steps.find((candidate) => candidate.name === name);
	if (!step) throw new Error(`Missing workflow step: ${name}`);
	return step;
}

function runStep(steps: Record<string, unknown>[], name: string) {
	return string(requiredStep(steps, name).run, `${name} run command`);
}

function commands(steps: Record<string, unknown>[], name: string) {
	return runStep(steps, name)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && line !== "set -euo pipefail");
}

function stepDirectory(steps: Record<string, unknown>[], name: string) {
	return string(requiredStep(steps, name)["working-directory"], name);
}

function databaseName(databaseUrl: string) {
	return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
}

function occurrences(value: string, needle: string) {
	return value.split(needle).length - 1;
}

function dockerContextSources(dockerfile: string) {
	return dockerfile
		.split("\n")
		.filter((line) => line.startsWith("COPY ") && !line.includes("--from="))
		.flatMap((line) => line.trim().split(/\s+/).slice(1, -1));
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected ${label} to be an object`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value))
		throw new Error(`Expected ${label} to be an array`);
	return value;
}

function string(value: unknown, label: string) {
	if (typeof value !== "string") {
		throw new Error(`Expected ${label} to be a string`);
	}
	return value;
}
