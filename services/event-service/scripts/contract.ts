import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";

const path = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));
const response = await createApp().request("/docs/openapi.json");
const document = (await response.json()) as Record<string, unknown>;
assertPaginationPolicy(document);
const output = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes("--check")) {
	if (
		!(await Bun.file(path).exists()) ||
		(await Bun.file(path).text()) !== output
	) {
		throw new Error(
			"openapi/openapi.json is stale; run bun run contract:export",
		);
	}
} else {
	await Bun.write(path, output);
}

function assertPaginationPolicy(document: Record<string, unknown>) {
	const requiredOperations = new Map([
		["eventRootsList", "rootEventId ASC"],
		["eventInvitationsList", "id ASC"],
		["eventMembershipsList", "userId ASC"],
		["eventPlacesList", "name ASC, id ASC"],
		["eventItineraryItemsList", "numeric sortKey ASC, id ASC"],
		["eventFeedEntriesList", "numeric createdRootRevision DESC, id DESC"],
		["eventFeedbackList", "updatedAt DESC, id DESC"],
		[
			"eventFeedbackUpdatesList",
			"changedAt DESC, feedbackId DESC, version DESC",
		],
	]);
	let aggregateBootstrapFound = false;
	const paths = document.paths as Record<
		string,
		Record<string, Record<string, unknown>>
	>;
	for (const operations of Object.values(paths)) {
		for (const operation of Object.values(operations)) {
			const operationId = operation.operationId;
			if (operationId === "eventsTreeGet") {
				const policy = operation["x-collection-policy"] as Record<
					string,
					unknown
				>;
				if (
					policy?.strategy !== "aggregate-bootstrap" ||
					policy.maxItems !== 500 ||
					policy.overflow !== "409 ROOT_GRAPH_LIMIT_EXCEEDED"
				) {
					throw new Error(
						"Aggregate bootstrap policy violation: eventsTreeGet",
					);
				}
				aggregateBootstrapFound = true;
			}
			if (
				typeof operationId !== "string" ||
				!requiredOperations.has(operationId)
			)
				continue;
			const policy = operation["x-pagination"] as
				| Record<string, unknown>
				| undefined;
			const parameters = (operation.parameters ?? []) as Array<
				Record<string, unknown>
			>;
			const names = new Set(parameters.map((parameter) => parameter.name));
			const responses = operation.responses as Record<string, unknown>;
			const responseSchema = JSON.stringify(responses);
			const expectedDefaultLimit =
				operationId === "eventFeedbackList" ? 10 : 50;
			const expectedMaxLimit =
				operationId === "eventFeedbackList"
					? 10
					: operationId === "eventFeedbackUpdatesList"
						? 50
						: 200;
			if (
				policy?.strategy !== "signed-keyset" ||
				policy.defaultLimit !== expectedDefaultLimit ||
				policy.maxLimit !== expectedMaxLimit ||
				policy.order !== requiredOperations.get(operationId) ||
				!names.has("limit") ||
				!names.has("cursor") ||
				!responses["400"] ||
				!responseSchema.includes('"items"') ||
				!responseSchema.includes('"pageInfo"')
			) {
				throw new Error(`Pagination policy violation: ${operationId}`);
			}
			requiredOperations.delete(operationId);
		}
	}
	if (requiredOperations.size > 0) {
		throw new Error(
			`Missing paginated operations: ${[...requiredOperations].join(", ")}`,
		);
	}
	if (!aggregateBootstrapFound) {
		throw new Error("Missing bounded aggregate bootstrap: eventsTreeGet");
	}
}
