import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	buildDeployPlan,
	buildRollbackPlan,
	captureReleaseRecord,
	parseReleaseRecord,
	parseRollbackProof,
	type ReleaseRecord,
	type RollbackProof,
} from "./crew-next-release";

const currentId = "a".repeat(40);
const previousId = "b".repeat(40);
const grantSha = createHash("sha256")
	.update(
		await Bun.file(
			new URL("../infra/postgres/grant-runtime.sql", import.meta.url),
		).text(),
	)
	.digest("hex");

describe("Crew Next staged release contract", () => {
	test("accepts only an explicit staging record with immutable artifacts", () => {
		expect(parseReleaseRecord(release())).toEqual(release());
		for (const drifted of [
			{ ...release(), environment: "production" },
			{ ...release(), publicGatewayOrigin: "http://gateway.crew-haus.com" },
			{ ...release(), mobileGatewayBaseUrl: "https://other.crew-haus.com" },
			{
				...release(),
				images: { ...release().images, "api-gateway": "crew/api-gateway:main" },
			},
			{ ...release(), unexpected: true },
		]) {
			expect(() => parseReleaseRecord(drifted)).toThrow();
		}
	});

	test("plans migration, grants, every runtime, convergence and both probe layers", () => {
		const target = release();
		const previous = release({
			releaseId: previousId,
			databaseReleaseId: previousId,
			recordedAt: "2026-07-19T10:00:00.000Z",
			images: images("1", "2", "3"),
		});
		const plan = buildDeployPlan({
			target,
			previous,
			rollbackProof: proof(),
			actualRuntimeGrantSha256: grantSha,
		});
		expect(plan.execution).toBe("dry-run-only");
		expect(plan.steps.map(({ kind }) => kind)).toEqual([
			"verify-clean-source",
			"verify-previous-capture",
			"verify-immutable-images",
			"run-migrations",
			"apply-runtime-grants",
			"update-services",
			"wait-for-convergence",
			"probe-private-health",
			"probe-public-gateway",
			"capture-release",
		]);
		const migrations = plan.steps.find(
			(step) => step.kind === "run-migrations",
		);
		expect(migrations).toMatchObject({
			mode: "replicated-job",
			requireSuccessfulExit: true,
		});
		expect(migrations?.jobs).toHaveLength(2);
		const rollout = plan.steps.find((step) => step.kind === "update-services");
		expect(rollout?.services.map(({ name }) => name)).toEqual([
			"crew-next-staging_user-api",
			"crew-next-staging_magic-worker",
			"crew-next-staging_push-worker",
			"crew-next-staging_event-api",
			"crew-next-staging_attachment-worker",
			"crew-next-staging_notification-worker",
			"crew-next-staging_recap-retention-worker",
			"crew-next-staging_api-gateway",
		]);
		expect(
			rollout?.services.every(
				({ labels }) =>
					labels["crew.release-id"] === currentId &&
					labels["crew.mobile-gateway-base-url"] ===
						"https://gateway.staging.crew-haus.com",
			),
		).toBe(true);
	});

	test("fails before planning when grants or rollback proof do not match", () => {
		const previous = release({
			releaseId: previousId,
			databaseReleaseId: previousId,
			images: images("1", "2", "3"),
		});
		expect(() =>
			buildDeployPlan({
				target: release(),
				previous,
				rollbackProof: proof(),
				actualRuntimeGrantSha256: "0".repeat(64),
			}),
		).toThrow("runtime-grant digest");
		expect(() =>
			buildDeployPlan({
				target: release(),
				previous,
				rollbackProof: proof({ toReleaseId: "c".repeat(40) }),
				actualRuntimeGrantSha256: grantSha,
			}),
		).toThrow("proof");
	});

	test("rolls code back gateway-first while retaining current database state", () => {
		const current = release();
		const previous = release({
			releaseId: previousId,
			databaseReleaseId: previousId,
			images: images("1", "2", "3"),
		});
		const plan = buildRollbackPlan({
			current,
			previous,
			rollbackProof: proof(),
		});
		expect(plan.steps.map(({ kind }) => kind)).not.toContain("run-migrations");
		expect(plan.steps.map(({ kind }) => kind)).not.toContain(
			"apply-runtime-grants",
		);
		expect(plan.resultingState).toEqual({
			releaseId: previousId,
			databaseReleaseId: currentId,
			runtimeGrantSha256: grantSha,
			images: previous.images,
		});
		const database = plan.steps.find(
			(step) => step.kind === "retain-database-state",
		);
		expect(database).toMatchObject({
			migrationAction: "none",
			grantAction: "none",
			dataRestoreAction: "none",
		});
		const rollout = plan.steps.find((step) => step.kind === "update-services");
		expect(rollout?.services[0]?.name).toBe("crew-next-staging_api-gateway");
		expect(
			rollout?.services.every(
				({ labels }) =>
					labels["crew.release-id"] === previousId &&
					labels["crew.database-release-id"] === currentId,
			),
		).toBe(true);
	});

	test("captures one consistent previous release from all eight Swarm services", () => {
		const captured = captureReleaseRecord(
			inspectFixture(),
			"2026-07-20T10:00:00.000Z",
		);
		expect(captured).toEqual(release());
		expect(() =>
			captureReleaseRecord(
				inspectFixture().slice(1),
				"2026-07-20T10:00:00.000Z",
			),
		).toThrow("every Crew Next runtime service");
		const inconsistent = inspectFixture();
		inconsistent[1].Spec.Labels["crew.release-id"] = previousId;
		expect(() =>
			captureReleaseRecord(inconsistent, "2026-07-20T10:00:00.000Z"),
		).toThrow("differs");
	});

	test("accepts only a bounded immutable rollback compatibility proof", () => {
		expect(parseRollbackProof(proof())).toEqual(proof());
		expect(() =>
			parseRollbackProof(proof({ evidence: "manual:looks-good" })),
		).toThrow("immutable ci: reference");
	});
});

function release(overrides: Partial<ReleaseRecord> = {}): ReleaseRecord {
	return {
		schemaVersion: 1,
		environment: "staging",
		stack: "crew-next-staging",
		releaseId: currentId,
		databaseReleaseId: currentId,
		recordedAt: "2026-07-20T10:00:00.000Z",
		publicGatewayOrigin: "https://gateway.staging.crew-haus.com",
		mobileGatewayBaseUrl: "https://gateway.staging.crew-haus.com",
		runtimeGrantSha256: grantSha,
		images: images("4", "5", "6"),
		...overrides,
	};
}

function proof(overrides: Partial<RollbackProof> = {}): RollbackProof {
	return {
		schemaVersion: 1,
		environment: "staging",
		fromReleaseId: currentId,
		toReleaseId: previousId,
		databaseReleaseId: currentId,
		verifiedAt: "2026-07-20T09:59:00.000Z",
		evidence: `ci:crew-next:rollback-compatibility:${currentId}`,
		evidenceSha256: "f".repeat(64),
		...overrides,
	};
}

function images(gateway: string, user: string, event: string) {
	return {
		"api-gateway": `registry.crew-haus.com/crew/api-gateway@sha256:${gateway.repeat(64)}`,
		"user-service": `registry.crew-haus.com/crew/user-service@sha256:${user.repeat(64)}`,
		"event-service": `registry.crew-haus.com/crew/event-service@sha256:${event.repeat(64)}`,
	};
}

function inspectFixture() {
	const record = release();
	const definitions = [
		["user-api", "user-service"],
		["magic-worker", "user-service"],
		["push-worker", "user-service"],
		["event-api", "event-service"],
		["attachment-worker", "event-service"],
		["notification-worker", "event-service"],
		["recap-retention-worker", "event-service"],
		["api-gateway", "api-gateway"],
	] as const;
	return definitions.map(([name, image]) => ({
		Spec: {
			Name: `crew-next-staging_${name}`,
			Labels: {
				"crew.environment": record.environment,
				"crew.release-id": record.releaseId,
				"crew.database-release-id": record.databaseReleaseId,
				"crew.runtime-grant-sha256": record.runtimeGrantSha256,
				"crew.public-gateway-origin": record.publicGatewayOrigin,
				"crew.mobile-gateway-base-url": record.mobileGatewayBaseUrl,
			},
			TaskTemplate: { ContainerSpec: { Image: record.images[image] } },
		},
	}));
}
