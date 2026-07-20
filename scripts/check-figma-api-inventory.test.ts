import { describe, expect, test } from "bun:test";
import { validateFigmaApiInventory } from "./check-figma-api-inventory";

const root = new URL("../", import.meta.url);
const inventory = await Bun.file(
	new URL("docs/product/figma-screen-inventory.md", root),
).text();
const contract = await Bun.file(
	new URL("services/api-gateway/openapi/openapi.json", root),
).json();

describe("Figma API inventory contract", () => {
	test("matches every Current row to the pinned Gateway method, path and operationId", () => {
		expect(validateFigmaApiInventory(inventory, contract)).toEqual([]);
	});

	test("rejects current route drift", () => {
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
