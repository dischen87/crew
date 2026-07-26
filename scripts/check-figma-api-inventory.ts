type OpenApiOperation = { operationId?: unknown };
type OpenApiDocument = {
	paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
};

const repositoryRoot = new URL("../", import.meta.url);
const inventoryUrl = new URL(
	"docs/product/figma-screen-inventory.md",
	repositoryRoot,
);
const handoffUrl = new URL(
	"docs/product/figma-handoff/03-flows-and-annotations.md",
	repositoryRoot,
);
const evidenceUrl = new URL(
	"docs/product/figma-handoff/04-evidence-and-provenance.md",
	repositoryRoot,
);
const evidenceManifestUrl = new URL(
	"docs/product/figma-handoff/asset-manifest.sha256",
	repositoryRoot,
);
const mobileRouteTypesUrl = new URL(
	"apps/mobile/src/navigation/types.ts",
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

export function validateFigmaRouteInventory(
	routeTypesSource: string,
	handoffMarkdown: string,
): string[] {
	const errors: string[] = [];
	const routeTypeBlock = routeTypesSource.match(
		/export type RootStackParamList = \{([\s\S]*?)^\};/m,
	)?.[1];
	const crosswalk = handoffMarkdown.match(
		/## Current runtime route crosswalk\n([\s\S]*?)(?=\n## )/,
	)?.[1];
	if (!routeTypeBlock) return ["RootStackParamList was not found"];
	if (!crosswalk) return ["Current runtime route crosswalk was not found"];

	const runtimeRoutes = new Set(
		[...routeTypeBlock.matchAll(/^[ \t]{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(
			([, route]) => route,
		),
	);
	const documentedRoutes = new Set<string>();
	for (const [, route, coverage] of crosswalk.matchAll(
		/^\| `([^`]+)` \| ([^|]+) \|/gm,
	)) {
		if (documentedRoutes.has(route)) {
			errors.push(`Duplicate runtime route mapping: ${route}`);
		}
		documentedRoutes.add(route);
		if (!/`SCR-\d{3}`|`EVIDENCE-ONLY`/.test(coverage)) {
			errors.push(`${route}: coverage must name an SCR or EVIDENCE-ONLY`);
		}
	}

	for (const route of runtimeRoutes) {
		if (!documentedRoutes.has(route)) {
			errors.push(`Missing runtime route mapping: ${route}`);
		}
	}
	for (const route of documentedRoutes) {
		if (!runtimeRoutes.has(route)) {
			errors.push(`Stale runtime route mapping: ${route}`);
		}
	}
	if (runtimeRoutes.size === 0) errors.push("No runtime routes found");
	if (documentedRoutes.size === 0) {
		errors.push("No runtime route mappings found");
	}
	return errors;
}

export function validateFigmaEvidenceManifest(
	markdown: string,
	manifest: string,
): string[] {
	const listed = new Set(
		manifest
			.split("\n")
			.map((line) => line.match(/^[a-f0-9]{64} {2}(.+)$/)?.[1])
			.filter((path): path is string => path !== undefined),
	);
	const linked = new Set(
		[
			...markdown.matchAll(
				/\]\(\.\.\/\.\.\/\.\.\/(apps\/mobile\/evidence\/[^)#]+)/g,
			),
		]
			.map(([, path]) => path)
			.filter((path): path is string => path !== undefined),
	);
	if (linked.size === 0) return ["No linked mobile evidence artifacts found"];
	return [...linked]
		.filter((path) => !listed.has(path))
		.map((path) => `Missing linked evidence checksum: ${path}`);
}

export async function checkFigmaApiInventory(): Promise<void> {
	const [
		markdown,
		document,
		routeTypesSource,
		handoffMarkdown,
		evidenceMarkdown,
		evidenceManifest,
	] = await Promise.all([
		Bun.file(inventoryUrl).text(),
		Bun.file(gatewayContractUrl).json() as Promise<OpenApiDocument>,
		Bun.file(mobileRouteTypesUrl).text(),
		Bun.file(handoffUrl).text(),
		Bun.file(evidenceUrl).text(),
		Bun.file(evidenceManifestUrl).text(),
	]);
	const errors = [
		...validateFigmaApiInventory(markdown, document),
		...validateFigmaRouteInventory(routeTypesSource, handoffMarkdown),
		...validateFigmaEvidenceManifest(evidenceMarkdown, evidenceManifest),
	];
	if (errors.length > 0) {
		throw new Error(
			`Figma inventory is stale:\n${errors.map((error) => `- ${error}`).join("\n")}`,
		);
	}
}

if (import.meta.main) await checkFigmaApiInventory();
