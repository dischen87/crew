import { describe, expect, test } from "bun:test";
import {
	buildArtifacts,
	buildRoutes,
	detectProvenance,
	findStaleArtifacts,
	sha256,
} from "../scripts/generate.ts";
import { gatewayRoutes, gatewaySchemas } from "../src/generated/routes.ts";

const packageRoot = new URL("../", import.meta.url);
const repositoryRoot = new URL("../../../", import.meta.url);
const sourceUrl = new URL(
	"../../../services/api-gateway/openapi/openapi.json",
	import.meta.url,
);

describe("gateway contract generation", () => {
	test("the checked-in artifacts match the producer contract", async () => {
		const result = Bun.spawnSync(["bun", "scripts/generate.ts", "--check"], {
			cwd: decodeURIComponent(packageRoot.pathname),
		});
		expect(result.exitCode).toBe(0);
		expect(new TextDecoder().decode(result.stderr)).toBe("");
	});

	test("the pin is byte exact and its source provenance is honest", async () => {
		const source = new Uint8Array(await Bun.file(sourceUrl).arrayBuffer());
		const pinned = new Uint8Array(
			await Bun.file(
				new URL("contracts/gateway.openapi.json", packageRoot),
			).arrayBuffer(),
		);
		const lock = await Bun.file(
			new URL("contracts/contract.lock.json", packageRoot),
		).json();

		expect(pinned).toEqual(source);
		expect(lock.contract.digest).toBe(`sha256:${sha256(source)}`);
		expect(lock.contract.byteCount).toBe(source.byteLength);
		expect(lock.contract).toMatchObject(detectProvenance(source));
	});

	test("the route manifest contains every operation exactly once in stable order", async () => {
		const document = await Bun.file(sourceUrl).json();
		const rebuilt = buildRoutes(document);
		const operationIds = gatewayRoutes.map((route) => route.operationId);

		expect(new Set(operationIds).size).toBe(operationIds.length);
		expect(operationIds).toContain("placesSearch");
		expect(operationIds).toEqual(
			[...operationIds].sort((left, right) => left.localeCompare(right, "en")),
		);
		expect(gatewayRoutes as readonly unknown[]).toEqual(rebuilt);
	});

	test("the runtime manifest pins status, representation and response schemas", () => {
		const eventsGet = gatewayRoutes.find(
			(route) => route.operationId === "eventsGet",
		);
		const logout = gatewayRoutes.find(
			(route) => route.operationId === "identitySessionsRevoke",
		);
		const finalize = gatewayRoutes.find(
			(route) => route.operationId === "eventAttachmentUploadsFinalize",
		);

		expect(eventsGet?.successResponses).toHaveLength(1);
		expect(eventsGet?.successResponses[0]).toMatchObject({
			status: 200,
			contentType: "application/json",
		});
		expect(eventsGet?.successResponses[0]?.schema).toBeDefined();
		expect(logout?.successResponses).toEqual([
			{ status: 204, contentType: null },
		]);
		expect(finalize?.successResponses.map(({ status }) => status)).toEqual([
			200, 202,
		]);
		expect(gatewaySchemas.UserServiceSession).toBeDefined();
		expect(gatewaySchemas.EventServiceEvent).toBeDefined();
	});

	test("the member directory is one authenticated minimal public contract", async () => {
		const route = gatewayRoutes.find(
			(candidate) => candidate.operationId === "eventMemberDirectoryGet",
		);
		expect(route).toMatchObject({
			method: "GET",
			path: "/core/v1/event-roots/{rootEventId}/member-directory",
			auth: "required",
			idempotency: "none",
			pathParameters: ["rootEventId"],
			queryParameters: ["cursor", "limit"],
			hasJsonBody: false,
		});
		const contract = await Bun.file(sourceUrl).json();
		expect(
			contract.paths[
				"/core/v1/event-roots/{rootEventId}/member-directory-source"
			],
		).toBeUndefined();
		expect(
			contract.paths["/core/v1/member-directory-profiles/resolve"],
		).toBeUndefined();
		const member = gatewaySchemas.MemberDirectoryPage?.properties?.items?.items;
		expect(member?.additionalProperties).toBe(false);
		expect(Object.keys(member?.properties ?? {})).toEqual([
			"userId",
			"displayName",
		]);
		for (const forbidden of [
			"email",
			"avatarUrl",
			"locale",
			"preferences",
			"devices",
			"profileVersion",
		]) {
			expect(member?.properties?.[forbidden]).toBeUndefined();
		}
	});

	test("root creation can only request a draft", async () => {
		const contract = await Bun.file(sourceUrl).json();
		expect(
			contract.paths["/core/v1/event-roots"].post.requestBody.content[
				"application/json"
			].schema.properties.status,
		).toEqual({ type: "string", enum: ["draft"], default: "draft" });
	});

	test("the team collaboration union stays strict and scoped", async () => {
		const contract = await Bun.file(sourceUrl).json();
		const mutationVariants =
			contract.paths["/core/v1/sync/push"].post.requestBody.content[
				"application/json"
			].schema.properties.mutations.items.oneOf;
		expect(
			mutationVariants
				.map(
					(variant: { properties: { kind: { enum: string[] } } }) =>
						variant.properties.kind.enum[0],
				)
				.filter((kind: string) => kind.startsWith("team.")),
		).toEqual([
			"team.assignments.publish",
			"team.decision.replace",
			"team.response.set",
		]);

		const recordVariants =
			gatewaySchemas.EventServiceSyncBootstrapResponse?.properties?.records
				?.items?.oneOf ?? [];
		expect(
			recordVariants
				.map((variant) => variant.properties?.entityType?.enum?.[0])
				.filter(
					(entityType): entityType is string =>
						typeof entityType === "string" && entityType.startsWith("team"),
				),
		).toEqual([
			"teamAssignmentSet",
			"teamAssignmentRoster",
			"teamAssignment",
			"teamDecision",
			"teamResponse",
		]);

		const publicTeam = gatewaySchemas.EventServiceSyncTeamPublicTeamData;
		const roster = gatewaySchemas.EventServiceSyncTeamAssignmentRosterData;
		const assignment = gatewaySchemas.EventServiceSyncTeamAssignmentData;
		const decision = gatewaySchemas.EventServiceSyncTeamDecisionData;
		expect(publicTeam?.additionalProperties).toBe(false);
		expect(Object.keys(publicTeam?.properties ?? {})).toEqual([
			"id",
			"name",
			"color",
		]);
		expect(publicTeam?.properties?.memberUserIds).toBeUndefined();
		expect(
			roster?.properties?.teams?.items?.properties?.memberUserIds,
		).toBeDefined();
		expect(assignment?.properties?.team?.$ref).toBe(
			"#/components/schemas/EventServiceSyncTeamPublicTeamData",
		);
		expect(decision?.additionalProperties).toBe(false);
		expect(JSON.stringify(decision)).not.toContain("userId");
	});

	test("the community detail runtime schema is complete and strict", () => {
		const detail = gatewaySchemas.EventServiceCommunityFeedbackDetail;
		expect(detail).toMatchObject({
			type: "object",
			additionalProperties: false,
		});
		expect(detail?.required).toEqual(
			expect.arrayContaining([
				"comments",
				"commentCount",
				"statusHistory",
				"statusHistoryCount",
			]),
		);
		expect(detail?.properties?.comments?.maxItems).toBe(20);
		expect(detail?.properties?.statusHistory?.maxItems).toBe(20);
		for (const forbidden of [
			"authorUserId",
			"changedBy",
			"diagnostics",
			"attachments",
			"context",
		]) {
			expect(detail?.properties?.[forbidden]).toBeUndefined();
		}
	});

	test("the duplicate suggestion contract is generated, minimal and bounded", () => {
		const route = gatewayRoutes.find(
			(candidate) =>
				candidate.operationId === "eventFeedbackDuplicateSuggestionsList",
		);
		expect(route).toMatchObject({
			method: "GET",
			path: "/core/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions",
			auth: "required",
			idempotency: "none",
			pathParameters: ["rootEventId"],
			queryParameters: ["cursor", "limit", "q"],
			hasJsonBody: false,
		});
		expect(route?.successResponses.map(({ status }) => status)).toEqual([200]);
		const suggestion =
			gatewaySchemas.EventServiceCommunityFeedbackDuplicateSuggestion;
		expect(suggestion?.additionalProperties).toBe(false);
		expect(Object.keys(suggestion?.properties ?? {})).toEqual([
			"id",
			"title",
			"status",
			"voteCount",
		]);
		for (const forbidden of [
			"body",
			"authorUserId",
			"diagnostics",
			"attachments",
			"context",
			"rootEventId",
			"duplicateOfFeedbackId",
		]) {
			expect(suggestion?.properties?.[forbidden]).toBeUndefined();
		}
	});

	test("the recap share manifest pins manager commands and a minimal public projection", async () => {
		const read = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapsGet",
		);
		const create = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapShareLinksCreate",
		);
		const resolve = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapShareLinksResolve",
		);
		const revoke = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapShareLinksRevoke",
		);

		expect(read).toMatchObject({
			method: "GET",
			path: "/core/v1/event-roots/{rootEventId}/recap",
			auth: "required",
			idempotency: "none",
			pathParameters: ["rootEventId"],
			hasJsonBody: false,
		});
		expect(create).toMatchObject({
			method: "POST",
			path: "/core/v1/event-roots/{rootEventId}/recap/share-links",
			auth: "required",
			idempotency: "required",
			pathParameters: ["rootEventId"],
			hasJsonBody: true,
		});
		expect(create?.successResponses.map(({ status }) => status)).toEqual([201]);
		expect(resolve).toMatchObject({
			method: "POST",
			path: "/core/v1/recap-share-links/resolve",
			auth: "public",
			idempotency: "none",
			pathParameters: [],
			hasJsonBody: true,
		});
		expect(resolve?.successResponses.map(({ status }) => status)).toEqual([
			200,
		]);
		const contract = await Bun.file(sourceUrl).json();
		const consentSchema = gatewaySchemas.EventServiceEventRecapExternalConsent;
		const consentFieldSchema =
			gatewaySchemas.EventServiceEventRecapExternalConsentField;
		expect(consentSchema?.type).toEqual(["object", "null"]);
		expect(consentSchema?.required).toEqual(["fields"]);
		expect(consentSchema?.additionalProperties).toBe(false);
		expect(consentFieldSchema?.oneOf).toHaveLength(2);
		const bodyConsentField = consentFieldSchema?.oneOf?.find((candidate) =>
			candidate.properties?.field?.enum?.includes("body"),
		);
		const captionConsentField = consentFieldSchema?.oneOf?.find((candidate) =>
			candidate.properties?.field?.enum?.includes("caption"),
		);
		const bodyConsentRequired = [
			"ordinal",
			"requiredAuthorities",
			"authorDecision",
			"managerDecision",
			"actorCanDecide",
			"field",
		];
		expect(bodyConsentField?.required).toEqual(bodyConsentRequired);
		expect(captionConsentField?.required).toEqual([
			...bodyConsentRequired,
			"fieldRef",
			"attachmentOrdinal",
			"attachmentVersion",
			"caption",
		]);
		expect(bodyConsentField?.additionalProperties).toBe(false);
		expect(captionConsentField?.additionalProperties).toBe(false);
		for (const forbidden of [
			"sourceId",
			"sourceVersion",
			"rootEventId",
			"actorId",
			"userId",
			"authorId",
			"token",
			"url",
			"provenance",
			"decidedAt",
		]) {
			expect(JSON.stringify(consentSchema)).not.toContain(forbidden);
			expect(JSON.stringify(consentFieldSchema)).not.toContain(forbidden);
		}
		expect(bodyConsentField?.properties?.body).toBeUndefined();
		expect(captionConsentField?.properties?.fieldRef?.pattern).toBe(
			"^rcf_[A-Za-z0-9_-]{43}$",
		);
		expect(captionConsentField?.properties?.media).toBeUndefined();
		for (const operationId of [
			"eventRecapsGenerate",
			"eventRecapsPublish",
			"eventRecapExternalGrantsDecide",
		] as const) {
			const operation = gatewayRoutes.find(
				(route) => route.operationId === operationId,
			);
			expect(JSON.stringify(operation?.successResponses)).not.toContain(
				"externalConsent",
			);
		}
		const resolveResponses =
			contract.paths["/core/v1/recap-share-links/resolve"].post.responses;
		expect(resolveResponses["400"]).toBeUndefined();
		expect(resolveResponses["404"]).toBeDefined();
		expect(revoke).toMatchObject({
			method: "DELETE",
			path: "/core/v1/event-roots/{rootEventId}/recap/share-links/{shareLinkId}",
			auth: "required",
			idempotency: "required",
			pathParameters: ["rootEventId", "shareLinkId"],
			hasJsonBody: false,
		});
		const publicSchema = gatewaySchemas.EventServiceEventRecapShare;
		expect(publicSchema?.required).toEqual(["title", "items"]);
		expect(Object.keys(publicSchema?.properties ?? {})).toEqual([
			"title",
			"items",
		]);
		for (const forbidden of [
			"rootEventId",
			"version",
			"publishedAt",
			"sourceId",
			"sourceBody",
			"provenance",
			"media",
		]) {
			expect(JSON.stringify(publicSchema)).not.toContain(forbidden);
		}

		const externalGrant = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapExternalGrantsDecide",
		);
		const externalCreate = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapExternalShareLinksCreate",
		);
		const externalResolve = gatewayRoutes.find(
			(route) => route.operationId === "eventRecapExternalShareLinksResolve",
		);
		expect(externalGrant).toMatchObject({
			method: "POST",
			path: "/core/v1/event-roots/{rootEventId}/recap/external-grants",
			auth: "required",
			idempotency: "required",
			hasJsonBody: true,
		});
		expect(externalCreate).toMatchObject({
			method: "POST",
			path: "/core/v1/event-roots/{rootEventId}/recap/external-share-links",
			auth: "required",
			idempotency: "required",
			hasJsonBody: true,
		});
		expect(externalResolve).toMatchObject({
			method: "POST",
			path: "/core/v1/recap-external-share-links/resolve",
			auth: "public",
			idempotency: "none",
			pathParameters: [],
			hasJsonBody: true,
		});
		const externalResponses =
			contract.paths["/core/v1/recap-external-share-links/resolve"].post
				.responses;
		expect(externalResponses["400"]).toBeUndefined();
		expect(externalResponses["404"]).toBeDefined();
		const externalPublicSchema =
			gatewaySchemas.EventServiceEventRecapExternalShare;
		const externalPublicItemSchema =
			gatewaySchemas.EventServiceEventRecapExternalShareItem;
		expect(externalPublicSchema?.required).toEqual(["title", "items"]);
		expect(Object.keys(externalPublicSchema?.properties ?? {})).toEqual([
			"title",
			"items",
		]);
		expect(externalPublicItemSchema?.anyOf).toHaveLength(3);
		for (const itemVariant of externalPublicItemSchema?.anyOf ?? []) {
			expect(itemVariant.required).toEqual([
				"ordinal",
				"captions",
				"title",
				"body",
			]);
			expect(itemVariant.additionalProperties).toBe(false);
			expect(itemVariant.properties?.captions?.maxItems).toBe(10);
		}
		const captionOnlyVariant = externalPublicItemSchema?.anyOf?.find(
			(candidate) =>
				candidate.properties?.title?.type === "null" &&
				candidate.properties?.body?.type === "null",
		);
		expect(captionOnlyVariant?.properties?.captions?.minItems).toBe(1);
		for (const forbidden of [
			"rootEventId",
			"sourceId",
			"sourceVersion",
			"userId",
			"membership",
			"provenance",
			"token",
			"media",
		]) {
			expect(JSON.stringify(externalPublicSchema)).not.toContain(forbidden);
		}
	});

	test("a one-byte artifact drift is rejected", async () => {
		const source = new Uint8Array(await Bun.file(sourceUrl).arrayBuffer());
		const artifacts = await buildArtifacts(source, detectProvenance(source));
		const stale = await findStaleArtifacts(artifacts, async (path) => {
			const expected = artifacts.find(
				(artifact) => artifact.path === path,
			)?.bytes;
			if (!expected) return null;
			if (path !== "contracts/gateway.openapi.json") return expected;
			const drifted = expected.slice();
			const lastIndex = drifted.length - 1;
			drifted[lastIndex] = (drifted[lastIndex] ?? 0) ^ 1;
			return drifted;
		});

		expect(stale).toEqual(["contracts/gateway.openapi.json"]);
	});

	test("repository CI runs every frozen mobile-client gate", async () => {
		const rootPackage = await Bun.file(
			new URL("package.json", repositoryRoot),
		).json();
		const workflow = await Bun.file(
			new URL(".github/workflows/crew-next-ci.yml", repositoryRoot),
		).text();
		const script = rootPackage.scripts?.["check:mobile-client"];

		expect(script).toContain("bun run generate:check");
		expect(script).toContain("bun run lint");
		expect(script).toContain("bun run typecheck");
		expect(script).toContain("bun test");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow).toContain("working-directory: packages/mobile-client");
		expect(workflow).toContain("bun run generate:check");
		expect(workflow).toContain("bun run lint");
		expect(workflow).toContain("bun run typecheck");
		expect(workflow).toContain("bun test");
	});
});
