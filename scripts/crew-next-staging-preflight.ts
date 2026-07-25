import { createHash } from "node:crypto";
import {
	buildDeployPlan,
	parseReleaseRecord,
	parseRollbackProof,
	type ReleaseRecord,
	type RollbackProof,
} from "./crew-next-release";

const ENVIRONMENT = "crew-next-staging";

type PreflightInput = {
	ref: string;
	sha: string;
	head: string;
	originMain: string;
	environment: unknown;
	registry: string;
	executor: string;
	target: ReleaseRecord;
	previous: ReleaseRecord;
	proof: RollbackProof;
	artifact: unknown;
	workflowRun: unknown;
	manifestSource: string;
	manifestSha256Source: string;
	rollbackPlanSource: string;
	actualRuntimeGrantSha256: string;
};

export function buildStagingPreflight(input: PreflightInput) {
	const environment = object(input.environment, "GitHub environment");
	if (environment.name !== ENVIRONMENT)
		throw new Error(`GitHub environment must be ${ENVIRONMENT}`);
	const rules = array(
		environment.protection_rules,
		"environment protection rules",
	);
	const reviewers = rules.find(
		(rule) =>
			object(rule, "environment protection rule").type === "required_reviewers",
	);
	if (
		!reviewers ||
		array(
			object(reviewers, "required reviewers rule").reviewers,
			"required reviewers",
		).length === 0
	)
		throw new Error("GitHub environment must require at least one reviewer");
	const branchPolicy = object(
		environment.deployment_branch_policy,
		"deployment branch policy",
	);
	if (branchPolicy.protected_branches !== true)
		throw new Error("GitHub environment must allow protected branches only");

	if (input.ref !== "refs/heads/main")
		throw new Error("Preflight only accepts refs/heads/main");
	const revision = immutableRevision(input.sha, "GitHub SHA");
	if (
		revision !== immutableRevision(input.head, "HEAD") ||
		revision !== immutableRevision(input.originMain, "origin/main")
	)
		throw new Error("GitHub SHA, HEAD and origin/main must match exactly");

	const registry = registryNamespace(input.registry);
	const executor = executorLabel(input.executor);
	const target = parseReleaseRecord(input.target);
	if (target.releaseId !== revision || target.databaseReleaseId !== revision)
		throw new Error("Target release must equal the exact main revision");
	for (const image of Object.values(target.images))
		if (!image.startsWith(`${registry}/`))
			throw new Error("Every target image must use the configured registry");

	const proof = parseRollbackProof(input.proof);
	const evidence = verifyRollbackEvidence(
		proof,
		input.artifact,
		input.workflowRun,
		input.manifestSource,
		input.manifestSha256Source,
		input.rollbackPlanSource,
	);
	const deployPlan = buildDeployPlan({
		target,
		previous: parseReleaseRecord(input.previous),
		rollbackProof: proof,
		actualRuntimeGrantSha256: input.actualRuntimeGrantSha256,
	});
	if (deployPlan.execution !== "dry-run-only")
		throw new Error("Release contract is no longer dry-run-only");

	return {
		schemaVersion: 1 as const,
		execution: "validation-only" as const,
		environment: ENVIRONMENT,
		revision,
		registry,
		executor,
		evidence,
		deployPlan,
	};
}

function verifyRollbackEvidence(
	proof: RollbackProof,
	artifactValue: unknown,
	workflowRunValue: unknown,
	manifestSource: string,
	manifestSha256Source: string,
	rollbackPlanSource: string,
): {
	provider: "github-actions";
	runId: number;
	artifactId: number;
	artifactDigest: string;
} {
	const match = /^ci:github-actions:([1-9][0-9]*):([1-9][0-9]*)$/.exec(
		proof.evidence,
	);
	if (!match) {
		throw new Error(
			"Rollback evidence must identify one GitHub Actions run and artifact",
		);
	}
	const runId = Number(match[1]);
	const artifactId = Number(match[2]);
	if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(artifactId))
		throw new Error("Rollback evidence identifiers are out of range");

	const artifact = object(artifactValue, "rollback evidence artifact");
	const artifactRun = object(
		artifact.workflow_run,
		"rollback evidence artifact workflow run",
	);
	if (
		artifact.id !== artifactId ||
		artifact.expired !== false ||
		!Number.isSafeInteger(artifact.size_in_bytes) ||
		(artifact.size_in_bytes as number) <= 0 ||
		artifact.digest !== `sha256:${proof.evidenceSha256}` ||
		artifact.name !==
			`crew-next-rollback-compatibility-${proof.fromReleaseId}` ||
		artifactRun.id !== runId ||
		artifactRun.head_branch !== "main" ||
		artifactRun.head_sha !== proof.fromReleaseId
	) {
		throw new Error("Rollback evidence artifact does not match the proof");
	}

	const workflowRun = object(
		workflowRunValue,
		"rollback evidence workflow run",
	);
	const workflowPath =
		typeof workflowRun.path === "string" ? workflowRun.path.split("@")[0] : "";
	const workflowRepository = object(
		workflowRun.repository,
		"rollback evidence workflow repository",
	);
	if (
		workflowRun.id !== runId ||
		workflowRun.status !== "completed" ||
		workflowRun.conclusion !== "success" ||
		workflowRun.event !== "workflow_dispatch" ||
		workflowRun.head_branch !== "main" ||
		workflowRun.head_sha !== proof.fromReleaseId ||
		workflowPath !== ".github/workflows/crew-next-rollback-compatibility.yml"
	) {
		throw new Error("Rollback evidence workflow run is not trusted");
	}

	const manifestDigest = createHash("sha256")
		.update(manifestSource)
		.digest("hex");
	if (
		manifestSha256Source !== `${manifestDigest}  manifest.json\n` &&
		manifestSha256Source !== `${manifestDigest}  manifest.json`
	)
		throw new Error("Rollback evidence manifest checksum does not match");

	const manifest = object(
		JSON.parse(manifestSource) as unknown,
		"rollback evidence manifest",
	);
	exactKeys(manifest, "rollback evidence manifest", [
		"schemaVersion",
		"kind",
		"scope",
		"environment",
		"repository",
		"workflow",
		"runId",
		"fromReleaseId",
		"toReleaseId",
		"databaseReleaseId",
		"crewNextCiRunId",
		"crewNextCiHeadSha",
		"rollbackPlanSha256",
		"checks",
	]);
	const expectedChecks = [
		"exact-main-revision",
		"successful-crew-next-ci",
		"release-contract-tests",
		"dry-run-rollback-plan",
	];
	if (
		manifest.schemaVersion !== 1 ||
		manifest.kind !== "crew-next-rollback-compatibility" ||
		manifest.environment !== "staging" ||
		manifest.repository !== workflowRepository.full_name ||
		manifest.workflow !==
			".github/workflows/crew-next-rollback-compatibility.yml" ||
		manifest.runId !== runId ||
		manifest.fromReleaseId !== proof.fromReleaseId ||
		manifest.toReleaseId !== proof.toReleaseId ||
		manifest.databaseReleaseId !== proof.databaseReleaseId ||
		manifest.crewNextCiHeadSha !== proof.fromReleaseId ||
		!Number.isSafeInteger(manifest.crewNextCiRunId) ||
		(manifest.crewNextCiRunId as number) <= 0 ||
		JSON.stringify(manifest.checks) !== JSON.stringify(expectedChecks)
	)
		throw new Error("Rollback evidence manifest does not match the proof");

	const rollbackPlanDigest = createHash("sha256")
		.update(rollbackPlanSource)
		.digest("hex");
	if (manifest.rollbackPlanSha256 !== rollbackPlanDigest)
		throw new Error("Rollback evidence plan checksum does not match");
	const rollbackPlan = object(
		JSON.parse(rollbackPlanSource) as unknown,
		"rollback evidence plan",
	);
	if (
		rollbackPlan.execution !== "dry-run-only" ||
		rollbackPlan.action !== "rollback" ||
		object(rollbackPlan.current, "rollback evidence current release")
			.releaseId !== proof.fromReleaseId ||
		object(rollbackPlan.current, "rollback evidence current release")
			.databaseReleaseId !== proof.databaseReleaseId ||
		object(rollbackPlan.previous, "rollback evidence previous release")
			.releaseId !== proof.toReleaseId
	)
		throw new Error("Rollback evidence plan does not match the proof");

	if (manifest.scope === "validation-only/source-contract") {
		throw new Error(
			"Validation-only source-contract evidence cannot authorize runtime rollback",
		);
	}
	throw new Error("Unsupported runtime rollback evidence scope");
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
	return value;
}

function exactKeys(
	value: Record<string, unknown>,
	label: string,
	expected: string[],
) {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(canonical))
		throw new Error(`${label} has unexpected or missing fields`);
}

function immutableRevision(value: string, label: string) {
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value))
		throw new Error(`${label} must be an immutable lowercase Git revision`);
	return value;
}

function registryNamespace(value: string) {
	if (
		!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(
			value,
		)
	)
		throw new Error("CREW_NEXT_STAGING_REGISTRY is missing or invalid");
	return value;
}

function executorLabel(value: string) {
	if (!/^self-hosted:[a-z0-9][a-z0-9._-]{1,63}$/.test(value))
		throw new Error("CREW_NEXT_STAGING_EXECUTOR is missing or invalid");
	return value;
}

async function main() {
	const args = Bun.argv.slice(2);
	if (args.length % 2 !== 0)
		throw new Error("Preflight flags must be --name value pairs");
	const flags: Record<string, string> = {};
	const allowed = new Set([
		"ref",
		"sha",
		"head",
		"origin-main",
		"environment",
		"registry",
		"executor",
		"target",
		"previous",
		"proof",
		"artifact",
		"workflow-run",
		"manifest",
		"manifest-sha256",
		"rollback-plan",
	]);
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--") || !value)
			throw new Error("Preflight flags must be --name value pairs");
		const name = flag.slice(2);
		if (!allowed.has(name)) throw new Error(`Unknown flag --${name}`);
		if (name in flags) throw new Error(`Duplicate flag --${name}`);
		flags[name] = value;
	}
	const required = (name: string) => {
		const value = flags[name];
		if (!value) throw new Error(`Missing --${name}`);
		return value;
	};
	const [
		environment,
		target,
		previous,
		proof,
		artifact,
		workflowRun,
		manifestSource,
		manifestSha256Source,
		rollbackPlanSource,
		grantSource,
	] = await Promise.all([
		readJson(required("environment")),
		readJson(required("target")),
		readJson(required("previous")),
		readJson(required("proof")),
		readJson(required("artifact")),
		readJson(required("workflow-run")),
		Bun.file(required("manifest")).text(),
		Bun.file(required("manifest-sha256")).text(),
		Bun.file(required("rollback-plan")).text(),
		Bun.file(
			new URL("../infra/postgres/grant-runtime.sql", import.meta.url),
		).text(),
	]);
	const result = buildStagingPreflight({
		ref: required("ref"),
		sha: required("sha"),
		head: required("head"),
		originMain: required("origin-main"),
		environment,
		registry: required("registry"),
		executor: required("executor"),
		target: parseReleaseRecord(target),
		previous: parseReleaseRecord(previous),
		proof: parseRollbackProof(proof),
		artifact,
		workflowRun,
		manifestSource,
		manifestSha256Source,
		rollbackPlanSource,
		actualRuntimeGrantSha256: createHash("sha256")
			.update(grantSource)
			.digest("hex"),
	});
	console.log(JSON.stringify(result, null, 2));
}

async function readJson(path: string) {
	return JSON.parse(await Bun.file(path).text()) as unknown;
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "Preflight failed");
		process.exitCode = 1;
	});
}
