import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	ReleaseRecord,
	RollbackProof,
} from "../../scripts/crew-next-release";
import { buildRollbackPlan } from "../../scripts/crew-next-release";
import { buildStagingPreflight } from "../../scripts/crew-next-staging-preflight";

const root = new URL("../../", import.meta.url);
const workflow = await Bun.file(
	new URL(".github/workflows/crew-next-staging-preflight.yml", root),
).text();
const producerWorkflow = await Bun.file(
	new URL(".github/workflows/crew-next-rollback-compatibility.yml", root),
).text();
const revision = "a".repeat(40);
const previousRevision = "b".repeat(40);
const checkoutSha = "34e114876b0b11c390a56381ad16ebd13914f8d5";
const setupBunSha = "0c5077e51419868618aeaa5fe8019c62421857d6";
const uploadArtifactSha = "ea165f8d65b6e75b540449e92b4886f43607fa02";
const downloadArtifactSha = "d3f86a106a0bac45b974a628896c90dbdf5c8093";
const grantSha = createHash("sha256")
	.update(
		await Bun.file(new URL("infra/postgres/grant-runtime.sql", root)).text(),
	)
	.digest("hex");

describe("Crew Next staging preflight", () => {
	test("authenticates source-contract evidence and rejects it as runtime proof", () => {
		expect(() => buildStagingPreflight(input())).toThrow(
			"Validation-only source-contract evidence cannot authorize runtime rollback",
		);
	});

	test("fails closed on configuration, revision, registry or GitHub drift", () => {
		for (const [drift, message] of [
			[
				{ environment: { ...environment(), protection_rules: [] } },
				"require at least one reviewer",
			],
			[{ ref: "refs/heads/feature" }, "only accepts refs/heads/main"],
			[{ originMain: "c".repeat(40) }, "must match exactly"],
			[{ registry: "" }, "is missing or invalid"],
			[{ executor: "" }, "is missing or invalid"],
			[
				{
					target: release({
						images: images("other.example.com/crew"),
					}),
				},
				"configured registry",
			],
			[{ artifact: { ...artifact(), expired: true } }, "does not match"],
			[
				{ artifact: { ...artifact(), digest: `sha256:${"e".repeat(64)}` } },
				"does not match",
			],
			[
				{ workflowRun: { ...workflowRun(), conclusion: "failure" } },
				"workflow run is not trusted",
			],
			[
				{
					workflowRun: {
						...workflowRun(),
						path: ".github/workflows/untrusted.yml@main",
					},
				},
				"workflow run is not trusted",
			],
		] as const) {
			expect(() => buildStagingPreflight({ ...input(), ...drift })).toThrow(
				message,
			);
		}
	});

	test("fails closed on manifest, plan or unsupported runtime scope drift", () => {
		const valid = evidenceFiles();
		for (const [drift, message] of [
			[
				{
					manifestSha256Source: `${"0".repeat(64)}  manifest.json\n`,
				},
				"manifest checksum does not match",
			],
			[
				evidenceFiles({ fromReleaseId: "c".repeat(40) }),
				"manifest does not match the proof",
			],
			[
				{ rollbackPlanSource: `${valid.rollbackPlanSource} ` },
				"plan checksum does not match",
			],
			[
				evidenceFiles({ scope: "runtime/staging-rollback" }),
				"Unsupported runtime rollback evidence scope",
			],
		] as const) {
			expect(() => buildStagingPreflight({ ...input(), ...drift })).toThrow(
				message,
			);
		}
	});

	test("preflight is manual, read-only and downloads the exact evidence", () => {
		const parsed = object(Bun.YAML.parse(workflow), "workflow");
		const triggers = object(parsed.on, "triggers");
		expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
		expect(
			Object.keys(
				object(
					object(triggers.workflow_dispatch, "manual trigger").inputs,
					"manual inputs",
				),
			),
		).toEqual(["target_release", "previous_release", "rollback_proof"]);
		expect(object(parsed.permissions, "permissions")).toEqual({
			actions: "read",
			contents: "read",
		});
		expect(workflow).toContain("/environments/crew-next-staging");
		expect(workflow).toContain("refs/heads/main");
		expect(workflow).toContain("CREW_NEXT_STAGING_REGISTRY");
		expect(workflow).toContain("CREW_NEXT_STAGING_EXECUTOR");
		expect(workflow).toContain("crew-next-staging-preflight.ts");
		expect(workflow).toContain("/actions/artifacts/$evidence_artifact_id");
		expect(workflow).toContain("/actions/runs/$evidence_run_id");
		expect(workflow).toContain(
			`actions/download-artifact@${downloadArtifactSha}`,
		);
		expect(workflow).toContain("artifact-ids:");
		expect(workflow).toContain("merge-multiple: true");
		expect(workflow).toContain("--manifest-sha256");
		expect(workflow).toContain("--rollback-plan");
		expect(workflow).not.toMatch(/^\s+environment:/m);
		expect(workflow).not.toContain("secrets.");
		expect(workflow).not.toMatch(
			/\bdocker (?:service|stack)|\bssh\b|\bscp\b|\brsync\b/,
		);
	});

	test("producer is SHA-bound, validation-only and cannot deploy", () => {
		const parsed = object(
			Bun.YAML.parse(producerWorkflow),
			"producer workflow",
		);
		const triggers = object(parsed.on, "producer triggers");
		expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
		expect(
			Object.keys(
				object(
					object(triggers.workflow_dispatch, "manual trigger").inputs,
					"manual inputs",
				),
			),
		).toEqual(["current_release", "previous_release"]);
		expect(object(parsed.permissions, "producer permissions")).toEqual({
			actions: "read",
			contents: "read",
		});
		const job = object(
			object(parsed.jobs, "producer jobs")["source-contract"],
			"source-contract job",
		);
		expect(job["runs-on"]).toBe("ubuntu-24.04");
		expect(job["timeout-minutes"]).toBe(10);
		expect(job).not.toHaveProperty("environment");
		const steps = array(job.steps, "producer steps").map((value, index) =>
			object(value, `producer step ${index}`),
		);
		expect(step(steps, "Check out the dispatched main revision").uses).toBe(
			`actions/checkout@${checkoutSha}`,
		);
		expect(step(steps, "Set up Bun 1.3.9").uses).toBe(
			`oven-sh/setup-bun@${setupBunSha}`,
		);
		expect(
			step(steps, "Upload validation-only rollback source-contract evidence")
				.uses,
		).toBe(`actions/upload-artifact@${uploadArtifactSha}`);
		for (const candidate of steps) {
			if ("uses" in candidate)
				expect(candidate.uses).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
			if ("run" in candidate)
				expect(
					string(candidate.run, "producer command")
						.trimStart()
						.startsWith("set -euo pipefail\n"),
				).toBe(true);
		}
		const githubSha = ["$", "{{ github.sha }}"].join("");
		expect(producerWorkflow).toContain("refs/heads/main");
		expect(producerWorkflow).toContain(
			"/actions/workflows/crew-next-ci.yml/runs?",
		);
		expect(producerWorkflow).toContain("head_sha=$GITHUB_SHA");
		expect(producerWorkflow).toContain(
			`name: crew-next-rollback-compatibility-${githubSha}`,
		);
		expect(producerWorkflow).toContain(
			'scope: "validation-only/source-contract"',
		);
		expect(producerWorkflow).toContain("sha256sum manifest.json");
		expect(producerWorkflow).toContain(
			"steps.evidence.outputs.artifact-digest",
		);
		expect(producerWorkflow).toContain(
			'[[ "$ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]',
		);
		expect(producerWorkflow).toContain('evidence_sha256="$ARTIFACT_DIGEST"');
		expect(producerWorkflow).not.toContain("ARTIFACT_DIGEST#sha256:");
		expect(producerWorkflow).toContain("runtimeRollbackProof: false");
		expect(producerWorkflow).not.toContain("secrets.");
		expect(producerWorkflow).not.toMatch(
			/\bdocker (?:service|stack|push)|\bssh\b|\bscp\b|\brsync\b|\bkubectl\b|\bhelm\b/,
		);
	});
});

function input() {
	return {
		ref: "refs/heads/main",
		sha: revision,
		head: revision,
		originMain: revision,
		environment: environment(),
		registry: "registry.crew-haus.com/crew",
		executor: "self-hosted:crew-next-staging",
		target: release(),
		previous: release({
			releaseId: previousRevision,
			databaseReleaseId: previousRevision,
			images: images("registry.crew-haus.com/previous"),
		}),
		proof: proof(),
		artifact: artifact(),
		workflowRun: workflowRun(),
		...evidenceFiles(),
		actualRuntimeGrantSha256: grantSha,
	};
}

function environment() {
	return {
		name: "crew-next-staging",
		protection_rules: [
			{ type: "required_reviewers", reviewers: [{ type: "User" }] },
		],
		deployment_branch_policy: {
			protected_branches: true,
			custom_branch_policies: false,
		},
	};
}

function release(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
	return {
		schemaVersion: 1,
		environment: "staging",
		stack: "crew-next-staging",
		releaseId: revision,
		databaseReleaseId: revision,
		recordedAt: "2026-07-25T10:00:00.000Z",
		publicGatewayOrigin: "https://gateway.staging.crew-haus.com",
		mobileGatewayBaseUrl: "https://gateway.staging.crew-haus.com",
		runtimeGrantSha256: grantSha,
		images: images("registry.crew-haus.com/crew"),
		...overrides,
	};
}

function images(registry: string) {
	return {
		"api-gateway": `${registry}/api-gateway@sha256:${"1".repeat(64)}`,
		"user-service": `${registry}/user-service@sha256:${"2".repeat(64)}`,
		"event-service": `${registry}/event-service@sha256:${"3".repeat(64)}`,
	};
}

function proof(): RollbackProof {
	return {
		schemaVersion: 1,
		environment: "staging",
		fromReleaseId: revision,
		toReleaseId: previousRevision,
		databaseReleaseId: revision,
		verifiedAt: "2026-07-25T09:59:00.000Z",
		evidence: "ci:github-actions:12345:67890",
		evidenceSha256: "f".repeat(64),
	};
}

function evidenceFiles(manifestOverrides: Record<string, unknown> = {}) {
	const rollbackPlanSource = `${JSON.stringify(
		buildRollbackPlan({
			current: release(),
			previous: release({
				releaseId: previousRevision,
				databaseReleaseId: previousRevision,
				images: images("registry.crew-haus.com/previous"),
			}),
			rollbackProof: proof(),
		}),
		null,
		2,
	)}\n`;
	const manifestSource = `${JSON.stringify(
		{
			schemaVersion: 1,
			kind: "crew-next-rollback-compatibility",
			scope: "validation-only/source-contract",
			environment: "staging",
			repository: "crew/crew",
			workflow: ".github/workflows/crew-next-rollback-compatibility.yml",
			runId: 12_345,
			fromReleaseId: revision,
			toReleaseId: previousRevision,
			databaseReleaseId: revision,
			crewNextCiRunId: 54_321,
			crewNextCiHeadSha: revision,
			rollbackPlanSha256: createHash("sha256")
				.update(rollbackPlanSource)
				.digest("hex"),
			checks: [
				"exact-main-revision",
				"successful-crew-next-ci",
				"release-contract-tests",
				"dry-run-rollback-plan",
			],
			...manifestOverrides,
		},
		null,
		2,
	)}\n`;
	return {
		manifestSource,
		manifestSha256Source: `${createHash("sha256")
			.update(manifestSource)
			.digest("hex")}  manifest.json\n`,
		rollbackPlanSource,
	};
}

function artifact() {
	return {
		id: 67_890,
		name: `crew-next-rollback-compatibility-${revision}`,
		size_in_bytes: 1_024,
		expired: false,
		digest: `sha256:${"f".repeat(64)}`,
		workflow_run: {
			id: 12_345,
			head_branch: "main",
			head_sha: revision,
		},
	};
}

function workflowRun() {
	return {
		id: 12_345,
		status: "completed",
		conclusion: "success",
		event: "workflow_dispatch",
		head_branch: "main",
		head_sha: revision,
		path: ".github/workflows/crew-next-rollback-compatibility.yml@main",
		repository: { full_name: "crew/crew" },
	};
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

function string(value: unknown, label: string) {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function step(steps: Record<string, unknown>[], name: string) {
	const result = steps.find((candidate) => candidate.name === name);
	if (!result) throw new Error(`Missing workflow step ${name}`);
	return result;
}
