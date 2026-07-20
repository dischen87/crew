import { describe, expect, test } from "bun:test";

const workflowUrl = new URL("../workflows/deploy.yml", import.meta.url);
const source = await Bun.file(workflowUrl).text();

describe("legacy deploy quarantine", () => {
	test("cannot run from a push and requires an explicit manual confirmation", () => {
		validateQuarantine(source);
	});

	test("turns trigger, confirmation and production protection drift red", () => {
		for (const [needle, replacement] of [
			["  workflow_dispatch:\n", "  push:\n    branches: [main]\n"],
			["inputs.confirmation == 'DEPLOY_LEGACY'", "true"],
			["environment: legacy-production", "environment: legacy-staging"],
			[
				"jobs:\n",
				"jobs:\n  unguarded:\n    runs-on: ubuntu-latest\n    steps: []\n",
			],
		] as const) {
			const drifted = source.replace(needle, replacement);
			expect(drifted).not.toBe(source);
			expect(() => validateQuarantine(drifted)).toThrow();
		}
	});
});

function validateQuarantine(workflowSource: string) {
	expect(workflowSource).not.toMatch(/^\s+push:/m);
	expect(workflowSource).not.toMatch(/^\s+pull_request:/m);

	const workflow = object(Bun.YAML.parse(workflowSource), "workflow");
	expect(object(workflow.permissions, "permissions")).toEqual({
		contents: "read",
	});
	const triggers = object(workflow.on, "workflow triggers");
	expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);

	const dispatch = object(triggers.workflow_dispatch, "manual trigger");
	const inputs = object(dispatch.inputs, "manual inputs");
	const target = object(inputs.target, "target input");
	expect(target.required).toBe(true);
	expect(target.type).toBe("choice");
	expect(target.options).toEqual(["staging", "production"]);
	expect(object(inputs.confirmation, "confirmation input").required).toBe(true);

	const jobs = object(workflow.jobs, "jobs");
	for (const [name, value] of Object.entries(jobs)) {
		const condition = String(object(value, name).if ?? "");
		expect(condition).toContain("inputs.confirmation == 'DEPLOY_LEGACY'");
	}
	expect(object(jobs["deploy-staging"], "staging job").environment).toBe(
		"legacy-staging",
	);
	const production = object(jobs["deploy-production"], "production job");
	expect(production.environment).toBe("legacy-production");
	expect(String(production.if)).toContain("inputs.target == 'production'");

	const concurrency = object(workflow.concurrency, "concurrency");
	expect(concurrency.group).toBe("legacy-crew-deploy");
	expect(concurrency["cancel-in-progress"]).toBe(false);
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected ${label} to be an object`);
	}
	return value as Record<string, unknown>;
}
