type OpenApiOperation = { operationId?: unknown };
type OpenApiDocument = {
	paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
};

const repositoryRoot = new URL("../", import.meta.url);
const inventoryUrl = new URL(
	"docs/product/figma-screen-inventory.md",
	repositoryRoot,
);
const gatewayContractUrl = new URL(
	"services/api-gateway/openapi/openapi.json",
	repositoryRoot,
);
const methodAndPath = /^`(DELETE|GET|PATCH|POST|PUT) ([^`]+)`$/;
const operationId = /^`([^`]+)`$/;
const bead = /`crew-paq(?:\.[0-9]+)+`/;

export function validateFigmaApiInventory(
	markdown: string,
	document: OpenApiDocument,
): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	let rows = 0;
	let currentRows = 0;

	for (const [index, line] of markdown.split("\n").entries()) {
		if (!line.startsWith("| `API-")) continue;
		rows += 1;
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		const [idCell, status, target, operationCell] = cells;
		const id = idCell?.slice(1, -1) ?? "unknown";
		const location = `${id} (line ${index + 1})`;
		if (ids.has(id)) errors.push(`${location}: duplicate inventory ID`);
		ids.add(id);

		const targetMatch = target?.match(methodAndPath);
		if (!targetMatch) {
			errors.push(`${location}: invalid method/path cell`);
			continue;
		}
		const [, method, path] = targetMatch;
		if (!method || !path) continue;
		const contractOperation = document.paths?.[path]?.[method.toLowerCase()];

		if (status === "Current") {
			currentRows += 1;
			const operationMatch = operationCell?.match(operationId);
			if (!operationMatch?.[1]) {
				errors.push(`${location}: current row has no operation ID`);
				continue;
			}
			if (!contractOperation) {
				errors.push(
					`${location}: ${method} ${path} is absent from Gateway OpenAPI`,
				);
				continue;
			}
			if (contractOperation.operationId !== operationMatch[1]) {
				errors.push(
					`${location}: expected operationId ${operationMatch[1]}, found ${String(contractOperation.operationId)}`,
				);
			}
			continue;
		}

		if (!status?.startsWith("Planned — ") || !bead.test(status)) {
			errors.push(
				`${location}: status must be Current or name a planning Bead`,
			);
			continue;
		}
		if (operationCell !== "—") {
			errors.push(`${location}: planned row must not invent an operation ID`);
		}
		if (contractOperation) {
			errors.push(
				`${location}: ${method} ${path} now exists in Gateway OpenAPI; mark it Current with its operationId`,
			);
		}
	}

	if (rows === 0) errors.push("No API inventory rows found");
	if (currentRows === 0) errors.push("No Current API inventory rows found");
	return errors;
}

export async function checkFigmaApiInventory(): Promise<void> {
	const [markdown, document] = await Promise.all([
		Bun.file(inventoryUrl).text(),
		Bun.file(gatewayContractUrl).json() as Promise<OpenApiDocument>,
	]);
	const errors = validateFigmaApiInventory(markdown, document);
	if (errors.length > 0) {
		throw new Error(
			`Figma API inventory is stale:\n${errors.map((error) => `- ${error}`).join("\n")}`,
		);
	}
}

if (import.meta.main) await checkFigmaApiInventory();
