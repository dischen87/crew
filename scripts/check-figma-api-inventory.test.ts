import { describe, expect, test } from "bun:test";
import {
	validateFigmaApiInventory,
	validateFigmaEvidenceManifest,
	validateFigmaRouteInventory,
} from "./check-figma-api-inventory";

const root = new URL("../", import.meta.url);
const inventory = await Bun.file(
	new URL("docs/product/figma-screen-inventory.md", root),
).text();
const contract = await Bun.file(
	new URL("services/api-gateway/openapi/openapi.json", root),
).json();
const routeTypes = await Bun.file(
	new URL("apps/mobile/src/navigation/types.ts", root),
).text();
const handoff = await Bun.file(
	new URL("docs/product/figma-handoff/03-flows-and-annotations.md", root),
).text();
const evidence = await Bun.file(
	new URL("docs/product/figma-handoff/04-evidence-and-provenance.md", root),
).text();
const evidenceManifest = await Bun.file(
	new URL("docs/product/figma-handoff/asset-manifest.sha256", root),
).text();

describe("Figma API inventory contract", () => {
	test("matches every Current row to the pinned Gateway method, path and operationId", () => {
		expect(validateFigmaApiInventory(inventory, contract)).toEqual([]);
	});

	test("rejects current API operation drift", () => {
		const stale = inventory.replace(
			"`identityMagicLinksCreate`",
			"`staleMagicLinkOperation`",
		);
		expect(validateFigmaApiInventory(stale, contract)).toContainEqual(
			expect.stringContaining("expected operationId staleMagicLinkOperation"),
		);
	});

	test("forces a planned row to become Current when its contract lands", () => {
		const futureContract = structuredClone(contract);
		futureContract.paths["/core/v1/feedback/attachments/uploads"] = {
			post: { operationId: "feedbackAttachmentUploadsPrepare" },
		};
		expect(validateFigmaApiInventory(inventory, futureContract)).toContainEqual(
			expect.stringContaining("now exists in Gateway OpenAPI"),
		);
	});

	test("keeps shipped feedback operations authenticated and writes idempotent", () => {
		for (const [path, method, requiresIdempotency] of [
			["/core/v1/feedback", "post", true],
			["/core/v1/feedback/{feedbackId}", "get", false],
			["/core/v1/feedback/{feedbackId}/vote", "put", true],
			["/core/v1/feedback/{feedbackId}/comments", "post", true],
		] as const) {
			const operation = contract.paths[path][method];
			expect(operation.security).toEqual([{ userBearer: [] }]);
			expect(
				operation.parameters?.some(
					(parameter: { in?: string; name?: string; required?: boolean }) =>
						parameter.in === "header" &&
						parameter.name === "idempotency-key" &&
						parameter.required === true,
				),
			).toBe(requiresIdempotency);
		}
	});
});

describe("Figma runtime route crosswalk", () => {
	test("covers every current RootStack route", () => {
		expect(validateFigmaRouteInventory(routeTypes, handoff)).toEqual([]);
	});

	test("rejects missing and stale route mappings", () => {
		const addedRoute = routeTypes.replace(
			"\n};",
			"\n  NewSurface: undefined;\n};",
		);
		expect(validateFigmaRouteInventory(addedRoute, handoff)).toContain(
			"Missing runtime route mapping: NewSurface",
		);

		const staleHandoff = handoff.replace(
			"| `Events` | `SCR-001` |",
			"| `Events` | `SCR-001` |\n| `RetiredSurface` | `SCR-001` |",
		);
		expect(validateFigmaRouteInventory(routeTypes, staleHandoff)).toContain(
			"Stale runtime route mapping: RetiredSurface",
		);
	});
});

describe("Figma evidence manifest", () => {
	test("covers every linked mobile evidence artifact", () => {
		expect(validateFigmaEvidenceManifest(evidence, evidenceManifest)).toEqual(
			[],
		);
	});

	test("rejects a linked artifact without a checksum", () => {
		expect(
			validateFigmaEvidenceManifest(
				evidence,
				evidenceManifest.replace(
					/^.* {2}apps\/mobile\/evidence\/events-option-2\/01-events-ready-390x844\.png\n/m,
					"",
				),
			),
		).toContain(
			"Missing linked evidence checksum: apps/mobile/evidence/events-option-2/01-events-ready-390x844.png",
		);
	});
});
