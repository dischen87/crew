import { createHash } from "node:crypto";
import { isIP } from "node:net";

const ENVIRONMENT = "staging" as const;
const STACK = "crew-next-staging";
const POSTGRES_IMAGE =
	"postgres:17.10-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394";
const GRANT_FILE_URL = new URL(
	"../infra/postgres/grant-runtime.sql",
	import.meta.url,
);

const runtimeServices = [
	{ name: "user-api", image: "user-service" },
	{ name: "magic-worker", image: "user-service" },
	{ name: "push-worker", image: "user-service" },
	{ name: "event-api", image: "event-service" },
	{ name: "attachment-worker", image: "event-service" },
	{ name: "notification-worker", image: "event-service" },
	{ name: "recap-retention-worker", image: "event-service" },
	{ name: "api-gateway", image: "api-gateway" },
] as const;

const rollbackOrder = [
	"api-gateway",
	"event-api",
	"attachment-worker",
	"notification-worker",
	"recap-retention-worker",
	"user-api",
	"magic-worker",
	"push-worker",
] as const;

type ImageName = (typeof runtimeServices)[number]["image"];

export type ReleaseRecord = {
	schemaVersion: 1;
	environment: typeof ENVIRONMENT;
	stack: typeof STACK;
	releaseId: string;
	databaseReleaseId: string;
	recordedAt: string;
	publicGatewayOrigin: string;
	mobileGatewayBaseUrl: string;
	runtimeGrantSha256: string;
	images: Record<ImageName, string>;
};

export type RollbackProof = {
	schemaVersion: 1;
	environment: typeof ENVIRONMENT;
	fromReleaseId: string;
	toReleaseId: string;
	databaseReleaseId: string;
	verifiedAt: string;
	evidence: string;
	evidenceSha256: string;
};

export function parseReleaseRecord(value: unknown): ReleaseRecord {
	const record = object(value, "release record");
	exactKeys(record, "release record", [
		"schemaVersion",
		"environment",
		"stack",
		"releaseId",
		"databaseReleaseId",
		"recordedAt",
		"publicGatewayOrigin",
		"mobileGatewayBaseUrl",
		"runtimeGrantSha256",
		"images",
	]);
	if (record.schemaVersion !== 1) throw new Error("Unsupported schemaVersion");
	if (record.environment !== ENVIRONMENT)
		throw new Error("Only the explicit staging environment is supported");
	if (record.stack !== STACK) throw new Error(`Stack must be ${STACK}`);

	const images = object(record.images, "release images");
	exactKeys(images, "release images", [
		"api-gateway",
		"user-service",
		"event-service",
	]);
	const parsedImages = {
		"api-gateway": digestImage(images["api-gateway"], "api-gateway image"),
		"user-service": digestImage(images["user-service"], "user-service image"),
		"event-service": digestImage(
			images["event-service"],
			"event-service image",
		),
	};
	if (new Set(Object.values(parsedImages)).size !== 3)
		throw new Error("Each Crew Next service image must be distinct");

	const publicGatewayOrigin = httpsOrigin(
		record.publicGatewayOrigin,
		"publicGatewayOrigin",
	);
	const mobileGatewayBaseUrl = httpsOrigin(
		record.mobileGatewayBaseUrl,
		"mobileGatewayBaseUrl",
	);
	if (mobileGatewayBaseUrl !== publicGatewayOrigin)
		throw new Error("Mobile and public Gateway origins must match exactly");

	return {
		schemaVersion: 1,
		environment: ENVIRONMENT,
		stack: STACK,
		releaseId: revision(record.releaseId, "releaseId"),
		databaseReleaseId: revision(record.databaseReleaseId, "databaseReleaseId"),
		recordedAt: timestamp(record.recordedAt, "recordedAt"),
		publicGatewayOrigin,
		mobileGatewayBaseUrl,
		runtimeGrantSha256: sha256(record.runtimeGrantSha256, "runtimeGrantSha256"),
		images: parsedImages,
	};
}

export function parseRollbackProof(value: unknown): RollbackProof {
	const proof = object(value, "rollback proof");
	exactKeys(proof, "rollback proof", [
		"schemaVersion",
		"environment",
		"fromReleaseId",
		"toReleaseId",
		"databaseReleaseId",
		"verifiedAt",
		"evidence",
		"evidenceSha256",
	]);
	if (proof.schemaVersion !== 1) throw new Error("Unsupported schemaVersion");
	if (proof.environment !== ENVIRONMENT)
		throw new Error("Rollback proof must be for staging");
	const evidence = string(proof.evidence, "evidence");
	if (!/^ci:[a-z0-9][a-z0-9._:/-]{1,254}$/.test(evidence))
		throw new Error("Rollback evidence must be an immutable ci: reference");
	return {
		schemaVersion: 1,
		environment: ENVIRONMENT,
		fromReleaseId: revision(proof.fromReleaseId, "fromReleaseId"),
		toReleaseId: revision(proof.toReleaseId, "toReleaseId"),
		databaseReleaseId: revision(proof.databaseReleaseId, "databaseReleaseId"),
		verifiedAt: timestamp(proof.verifiedAt, "verifiedAt"),
		evidence,
		evidenceSha256: sha256(proof.evidenceSha256, "evidenceSha256"),
	};
}

export function captureReleaseRecord(
	inspectValue: unknown,
	recordedAtValue: unknown,
): ReleaseRecord {
	if (!Array.isArray(inspectValue))
		throw new Error("Docker service inspect input must be an array");
	const expectedNames = runtimeServices.map(({ name }) => `${STACK}_${name}`);
	const inspected = new Map<string, Record<string, unknown>>();
	for (const value of inspectValue) {
		const service = object(value, "Docker service");
		const spec = object(service.Spec, "Docker service Spec");
		const name = string(spec.Name, "Docker service name");
		if (!expectedNames.includes(name))
			throw new Error(`Unexpected Docker service ${name}`);
		if (inspected.has(name))
			throw new Error(`Duplicate Docker service ${name}`);
		inspected.set(name, spec);
	}
	if (inspected.size !== expectedNames.length)
		throw new Error(
			"Docker capture must contain every Crew Next runtime service",
		);

	const labelsFor = (name: string) =>
		object(inspected.get(`${STACK}_${name}`)?.Labels, `${name} labels`);
	const gatewayLabels = labelsFor("api-gateway");
	const label = (name: string) => string(gatewayLabels[name], `label ${name}`);
	for (const serviceName of runtimeServices.map(({ name }) => name)) {
		const labels = labelsFor(serviceName);
		for (const key of [
			"crew.environment",
			"crew.release-id",
			"crew.database-release-id",
			"crew.runtime-grant-sha256",
			"crew.public-gateway-origin",
			"crew.mobile-gateway-base-url",
		]) {
			if (labels[key] !== gatewayLabels[key])
				throw new Error(`Release label ${key} differs on ${serviceName}`);
		}
	}

	const imageFor = (name: string) => {
		const spec = inspected.get(`${STACK}_${name}`);
		const task = object(spec?.TaskTemplate, `${name} TaskTemplate`);
		const container = object(task.ContainerSpec, `${name} ContainerSpec`);
		return container.Image;
	};
	const groupedImages: Record<ImageName, unknown[]> = {
		"api-gateway": [],
		"user-service": [],
		"event-service": [],
	};
	for (const service of runtimeServices)
		groupedImages[service.image].push(imageFor(service.name));
	const images = Object.fromEntries(
		Object.entries(groupedImages).map(([name, values]) => {
			if (new Set(values).size !== 1)
				throw new Error(`${name} services do not share one immutable image`);
			return [name, values[0]];
		}),
	);

	return parseReleaseRecord({
		schemaVersion: 1,
		environment: label("crew.environment"),
		stack: STACK,
		releaseId: label("crew.release-id"),
		databaseReleaseId: label("crew.database-release-id"),
		recordedAt: recordedAtValue,
		publicGatewayOrigin: label("crew.public-gateway-origin"),
		mobileGatewayBaseUrl: label("crew.mobile-gateway-base-url"),
		runtimeGrantSha256: label("crew.runtime-grant-sha256"),
		images,
	});
}

export function buildDeployPlan(input: {
	target: ReleaseRecord;
	previous: ReleaseRecord;
	rollbackProof: RollbackProof;
	actualRuntimeGrantSha256: string;
}) {
	const target = parseReleaseRecord(input.target);
	const previous = parseReleaseRecord(input.previous);
	const proof = parseRollbackProof(input.rollbackProof);
	matchingEnvironment(target, previous);
	if (target.releaseId === previous.releaseId)
		throw new Error("Target release must differ from the captured release");
	if (target.databaseReleaseId !== target.releaseId)
		throw new Error("A forward deploy must migrate to its own release ID");
	if (target.runtimeGrantSha256 !== sha256(input.actualRuntimeGrantSha256))
		throw new Error(
			"Target runtime-grant digest does not match the repository",
		);
	matchingProof(proof, target, previous.releaseId);

	return {
		schemaVersion: 1,
		execution: "dry-run-only" as const,
		action: "deploy" as const,
		environment: ENVIRONMENT,
		stack: STACK,
		target,
		previous,
		steps: [
			{
				kind: "verify-clean-source" as const,
				revision: target.releaseId,
				requireHeadEqualsOriginMain: true,
				requireNoTrackedOrUntrackedChanges: true,
			},
			{
				kind: "verify-previous-capture" as const,
				requiredBeforeMutation: true,
				services: runtimeServices.map(({ name }) => `${STACK}_${name}`),
				expected: previous,
			},
			{
				kind: "verify-immutable-images" as const,
				images: target.images,
			},
			{
				kind: "run-migrations" as const,
				jobs: [
					{
						name: `user-migrate-${target.releaseId.slice(0, 12)}`,
						image: target.images["user-service"],
						command: ["bun", "services/user-service/scripts/migrate.ts"],
						secretEnvironment: {
							USER_DATABASE_URL: `${STACK}-user-owner-database-url`,
						},
					},
					{
						name: `event-migrate-${target.releaseId.slice(0, 12)}`,
						image: target.images["event-service"],
						command: ["bun", "services/event-service/scripts/migrate.ts"],
						secretEnvironment: {
							EVENT_DATABASE_URL: `${STACK}-event-owner-database-url`,
						},
					},
				],
				mode: "replicated-job",
				requireSuccessfulExit: true,
			},
			{
				kind: "apply-runtime-grants" as const,
				image: POSTGRES_IMAGE,
				grantFile: "infra/postgres/grant-runtime.sql",
				grantSha256: target.runtimeGrantSha256,
				adminUrlSecret: `${STACK}-postgres-admin-url`,
				requireSuccessfulExit: true,
			},
			{
				kind: "update-services" as const,
				services: updateOperations(
					target,
					runtimeServices.map(({ name }) => name),
				),
				policy: {
					order: "start-first",
					parallelism: 1,
					failureAction: "rollback",
					rollbackFailureAction: "pause",
				},
			},
			convergenceStep(),
			privateProbeStep(target),
			publicProbeStep(target),
			{
				kind: "capture-release" as const,
				requiredAfterSmoke: true,
				expected: target,
			},
		],
	};
}

export function buildRollbackPlan(input: {
	current: ReleaseRecord;
	previous: ReleaseRecord;
	rollbackProof: RollbackProof;
}) {
	const current = parseReleaseRecord(input.current);
	const previous = parseReleaseRecord(input.previous);
	const proof = parseRollbackProof(input.rollbackProof);
	matchingEnvironment(current, previous);
	if (current.releaseId === previous.releaseId)
		throw new Error("Rollback releases must differ");
	matchingProof(proof, current, previous.releaseId);
	const resultingState = {
		releaseId: previous.releaseId,
		databaseReleaseId: current.databaseReleaseId,
		runtimeGrantSha256: current.runtimeGrantSha256,
		images: previous.images,
	};
	const rollbackRelease: ReleaseRecord = {
		...previous,
		databaseReleaseId: current.databaseReleaseId,
		runtimeGrantSha256: current.runtimeGrantSha256,
	};

	return {
		schemaVersion: 1,
		execution: "dry-run-only" as const,
		action: "rollback" as const,
		environment: ENVIRONMENT,
		stack: STACK,
		current,
		previous,
		resultingState,
		steps: [
			{ kind: "verify-rollback-proof" as const, proof },
			{
				kind: "retain-database-state" as const,
				databaseReleaseId: current.databaseReleaseId,
				runtimeGrantSha256: current.runtimeGrantSha256,
				migrationAction: "none",
				grantAction: "none",
				dataRestoreAction: "none",
			},
			{
				kind: "update-services" as const,
				services: updateOperations(rollbackRelease, [...rollbackOrder]),
				policy: {
					order: "start-first",
					parallelism: 1,
					failureAction: "pause",
					rollbackFailureAction: "pause",
				},
			},
			convergenceStep(),
			privateProbeStep(rollbackRelease),
			publicProbeStep(rollbackRelease),
			{
				kind: "capture-release" as const,
				requiredAfterSmoke: true,
				expectedState: resultingState,
			},
		],
	};
}

function updateOperations(release: ReleaseRecord, order: readonly string[]) {
	return order.map((name) => {
		const definition = runtimeServices.find((service) => service.name === name);
		if (!definition) throw new Error(`Unknown runtime service ${name}`);
		return {
			name: `${STACK}_${name}`,
			image: release.images[definition.image],
			labels: {
				"crew.environment": ENVIRONMENT,
				"crew.release-id": release.releaseId,
				"crew.database-release-id": release.databaseReleaseId,
				"crew.runtime-grant-sha256": release.runtimeGrantSha256,
				"crew.public-gateway-origin": release.publicGatewayOrigin,
				"crew.mobile-gateway-base-url": release.mobileGatewayBaseUrl,
			},
		};
	});
}

function convergenceStep() {
	return {
		kind: "wait-for-convergence" as const,
		services: runtimeServices.map(({ name }) => `${STACK}_${name}`),
		timeoutSeconds: 180,
		requireDesiredRunningTasks: true,
		rejectPausedOrFailedUpdates: true,
	};
}

function privateProbeStep(release: ReleaseRecord) {
	return {
		kind: "probe-private-health" as const,
		fromOverlayNetwork: `${STACK}_internal`,
		probeImage: release.images["api-gateway"],
		checks: [
			{ url: "http://user-api:3001/internal/ready", service: "user-service" },
			{ url: "http://event-api:3002/internal/ready", service: "event-service" },
			{ url: "http://api-gateway:3000/internal/ready", service: "api-gateway" },
		],
		expect: { status: 200, jsonStatus: "ready" },
	};
}

function publicProbeStep(release: ReleaseRecord) {
	return {
		kind: "probe-public-gateway" as const,
		checks: [
			{
				url: `${release.publicGatewayOrigin}/internal/ready`,
				expect: { status: 200, service: "api-gateway", jsonStatus: "ready" },
			},
			{
				url: `${release.publicGatewayOrigin}/docs/openapi.json`,
				expect: { status: 200, openapi: "3.1.0" },
			},
		],
	};
}

function matchingEnvironment(left: ReleaseRecord, right: ReleaseRecord) {
	if (
		left.environment !== right.environment ||
		left.stack !== right.stack ||
		left.publicGatewayOrigin !== right.publicGatewayOrigin ||
		left.mobileGatewayBaseUrl !== right.mobileGatewayBaseUrl
	)
		throw new Error("Release records do not describe the same staging target");
}

function matchingProof(
	proof: RollbackProof,
	from: ReleaseRecord,
	toReleaseId: string,
) {
	if (
		proof.fromReleaseId !== from.releaseId ||
		proof.toReleaseId !== toReleaseId ||
		proof.databaseReleaseId !== from.databaseReleaseId
	)
		throw new Error(
			"Rollback compatibility proof does not match the release pair",
		);
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string) {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function exactKeys(
	value: Record<string, unknown>,
	label: string,
	expected: readonly string[],
) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.join("\0") !== wanted.join("\0"))
		throw new Error(`${label} fields must be exactly: ${wanted.join(", ")}`);
}

function revision(value: unknown, label: string) {
	const parsed = string(value, label);
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(parsed))
		throw new Error(`${label} must be a lowercase immutable Git revision`);
	return parsed;
}

function sha256(value: unknown, label = "SHA-256") {
	const parsed = string(value, label);
	if (!/^[0-9a-f]{64}$/.test(parsed))
		throw new Error(`${label} must be a lowercase SHA-256 digest`);
	return parsed;
}

function timestamp(value: unknown, label: string) {
	const parsed = string(value, label);
	if (
		Number.isNaN(Date.parse(parsed)) ||
		new Date(parsed).toISOString() !== parsed
	)
		throw new Error(`${label} must be a canonical UTC timestamp`);
	return parsed;
}

function digestImage(value: unknown, label: string) {
	const parsed = string(value, label);
	if (
		!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/.test(
			parsed,
		)
	)
		throw new Error(
			`${label} must be a canonical registry image@sha256 reference`,
		);
	return parsed;
}

function httpsOrigin(value: unknown, label: string) {
	const parsed = string(value, label);
	let url: URL;
	try {
		url = new URL(parsed);
	} catch {
		throw new Error(`${label} must be a URL`);
	}
	if (
		url.protocol !== "https:" ||
		url.origin !== parsed ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		isPrivateHost(url.hostname)
	)
		throw new Error(`${label} must be a canonical public HTTPS origin`);
	return parsed;
}

function isPrivateHost(hostname: string) {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".invalid") ||
		host.endsWith(".test") ||
		host.endsWith(".example")
	)
		return true;
	if (isIP(host) === 6)
		return host === "::1" || host.startsWith("fc") || host.startsWith("fd");
	if (isIP(host) !== 4) return false;
	const [a, b] = host.split(".").map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168)
	);
}

async function main() {
	const [action, ...rest] = Bun.argv.slice(2);
	if (!action) throw new Error(usage());
	const flags = parseFlags(rest);
	if (flags.environment !== ENVIRONMENT)
		throw new Error("Pass --environment staging explicitly");
	if (action === "capture") {
		allowedFlags(flags, ["environment", "inspect", "recorded-at"]);
		const inspect = await readJson(requiredFlag(flags, "inspect"));
		const record = captureReleaseRecord(
			inspect,
			requiredFlag(flags, "recorded-at"),
		);
		console.log(JSON.stringify(record, null, 2));
		return;
	}
	if (action === "deploy") {
		allowedFlags(flags, ["environment", "target", "previous", "proof"]);
		const [target, previous, proof, grantSource] = await Promise.all([
			readJson(requiredFlag(flags, "target")),
			readJson(requiredFlag(flags, "previous")),
			readJson(requiredFlag(flags, "proof")),
			Bun.file(GRANT_FILE_URL).text(),
		]);
		const plan = buildDeployPlan({
			target: parseReleaseRecord(target),
			previous: parseReleaseRecord(previous),
			rollbackProof: parseRollbackProof(proof),
			actualRuntimeGrantSha256: createHash("sha256")
				.update(grantSource)
				.digest("hex"),
		});
		console.log(JSON.stringify(plan, null, 2));
		return;
	}
	if (action === "rollback") {
		allowedFlags(flags, ["environment", "current", "previous", "proof"]);
		const [current, previous, proof] = await Promise.all([
			readJson(requiredFlag(flags, "current")),
			readJson(requiredFlag(flags, "previous")),
			readJson(requiredFlag(flags, "proof")),
		]);
		const plan = buildRollbackPlan({
			current: parseReleaseRecord(current),
			previous: parseReleaseRecord(previous),
			rollbackProof: parseRollbackProof(proof),
		});
		console.log(JSON.stringify(plan, null, 2));
		return;
	}
	throw new Error(usage());
}

function parseFlags(args: string[]) {
	if (args.length % 2 !== 0) throw new Error(usage());
	const flags: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || !value) throw new Error(usage());
		const name = flag.slice(2);
		if (name in flags) throw new Error(`Duplicate flag --${name}`);
		flags[name] = value;
	}
	return flags;
}

function allowedFlags(flags: Record<string, string>, allowed: string[]) {
	for (const flag of Object.keys(flags))
		if (!allowed.includes(flag)) throw new Error(`Unknown flag --${flag}`);
}

function requiredFlag(flags: Record<string, string>, name: string) {
	const value = flags[name];
	if (!value) throw new Error(`Missing --${name}`);
	return value;
}

async function readJson(path: string) {
	return JSON.parse(await Bun.file(path).text()) as unknown;
}

function usage() {
	return [
		"Usage:",
		"  bun scripts/crew-next-release.ts capture --environment staging --inspect FILE --recorded-at ISO_UTC",
		"  bun scripts/crew-next-release.ts deploy --environment staging --target FILE --previous FILE --proof FILE",
		"  bun scripts/crew-next-release.ts rollback --environment staging --current FILE --previous FILE --proof FILE",
	].join("\n");
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(
			error instanceof Error ? error.message : "Release plan failed",
		);
		process.exitCode = 1;
	});
}
