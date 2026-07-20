import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

type JsonObject = Record<string, unknown>;

export interface ContractProvenance {
	sourceCommit: string | null;
	sourceState: "committed" | "worktree";
}

export interface GeneratedArtifact {
	path: string;
	bytes: Uint8Array;
}

export interface RouteDescriptor {
	operationId: string;
	method: string;
	path: string;
	auth: "public" | "required";
	idempotency: "none" | "required";
	pathParameters: string[];
	queryParameters: string[];
	headerParameters: string[];
	hasJsonBody: boolean;
	successResponses: SuccessResponseDescriptor[];
}

export interface SuccessResponseDescriptor {
	status: number;
	contentType: "application/json" | null;
	schema?: JsonObject;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const packageRoot = new URL("../", import.meta.url);
const repositoryRoot = decodeURIComponent(
	new URL("../../../", import.meta.url).pathname,
);
const sourceUrl = new URL(
	"../../../services/api-gateway/openapi/openapi.json",
	import.meta.url,
);
const sourceRepositoryPath = "services/api-gateway/openapi/openapi.json";
const httpMethods = [
	"delete",
	"get",
	"head",
	"options",
	"patch",
	"post",
	"put",
	"trace",
] as const;

export async function buildArtifacts(
	sourceBytes: Uint8Array,
	provenance: ContractProvenance,
): Promise<GeneratedArtifact[]> {
	const document = JSON.parse(decoder.decode(sourceBytes)) as JsonObject;
	if (document.openapi !== "3.1.0") throw new Error("Expected OpenAPI 3.1.0");
	const digest = sha256(sourceBytes);
	const routes = buildRoutes(document);
	const componentSchemas = referencedComponentSchemas(document, routes);
	const info = document.info as JsonObject | undefined;
	const nodes = await openapiTS(document as unknown as OpenAPI3, {
		alphabetize: true,
		exportType: true,
	});
	const generatedTypes = `/**
 * Generated from contracts/gateway.openapi.json.
 * Pin: sha256:${digest}
 * Generator: openapi-typescript 7.13.0. Do not edit.
 */
${astToString(nodes)}`;
	const lock = `${JSON.stringify(
		{
			schemaVersion: 1,
			contract: {
				name: "api-gateway",
				source: "../../services/api-gateway/openapi/openapi.json",
				repositoryPath: sourceRepositoryPath,
				digest: `sha256:${digest}`,
				byteCount: sourceBytes.byteLength,
				version: info?.version,
				...provenance,
			},
		},
		null,
		2,
	)}\n`;

	return [
		{ path: "contracts/gateway.openapi.json", bytes: sourceBytes },
		{ path: "contracts/contract.lock.json", bytes: encoder.encode(lock) },
		{
			path: "src/generated/gateway.ts",
			bytes: encoder.encode(generatedTypes),
		},
		{
			path: "src/generated/routes.ts",
			bytes: encoder.encode(renderRoutes(routes, componentSchemas, digest)),
		},
	];
}

export function buildRoutes(document: JsonObject): RouteDescriptor[] {
	const paths = document.paths as JsonObject | undefined;
	if (!paths) throw new Error("OpenAPI paths are missing");
	const routes: RouteDescriptor[] = [];
	const operationIds = new Set<string>();

	for (const [path, pathItemValue] of Object.entries(paths)) {
		const pathItem = pathItemValue as JsonObject;
		for (const method of httpMethods) {
			const operationValue = pathItem[method];
			if (!isObject(operationValue)) continue;
			const operation = operationValue;
			const operationId = operation.operationId;
			if (typeof operationId !== "string" || operationId.length === 0) {
				throw new Error(`${method.toUpperCase()} ${path} has no operationId`);
			}
			if (operationIds.has(operationId)) {
				throw new Error(`Duplicate operationId ${operationId}`);
			}
			operationIds.add(operationId);
			const parameters = [
				...parametersFor(document, pathItem.parameters),
				...parametersFor(document, operation.parameters),
			];
			const security = operation.security ?? document.security;
			routes.push({
				operationId,
				method: method.toUpperCase(),
				path,
				auth: requiresAuthentication(security) ? "required" : "public",
				idempotency:
					operation["x-idempotency"] === "required" ? "required" : "none",
				pathParameters: parameterNames(parameters, "path"),
				queryParameters: parameterNames(parameters, "query"),
				headerParameters: parameterNames(parameters, "header"),
				hasJsonBody: hasJsonRequestBody(document, operation.requestBody),
				successResponses: successResponsesFor(document, operation),
			});
		}
	}

	return routes.sort((left, right) =>
		left.operationId.localeCompare(right.operationId, "en"),
	);
}

export async function findStaleArtifacts(
	artifacts: readonly GeneratedArtifact[],
	read: (path: string) => Promise<Uint8Array | null>,
): Promise<string[]> {
	const stale: string[] = [];
	for (const artifact of artifacts) {
		const actual = await read(artifact.path);
		if (!actual || !equalBytes(actual, artifact.bytes))
			stale.push(artifact.path);
	}
	return stale;
}

export function sha256(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function detectProvenance(sourceBytes: Uint8Array): ContractProvenance {
	const status = Bun.spawnSync(
		["/usr/bin/git", "status", "--porcelain", "--", sourceRepositoryPath],
		{ cwd: repositoryRoot },
	);
	if (
		status.exitCode !== 0 ||
		decoder.decode(status.stdout).trim().length > 0
	) {
		return { sourceCommit: null, sourceState: "worktree" };
	}
	const history = Bun.spawnSync(
		["/usr/bin/git", "log", "-1", "--format=%H", "--", sourceRepositoryPath],
		{ cwd: repositoryRoot },
	);
	const commit = decoder.decode(history.stdout).trim();
	if (history.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) {
		return { sourceCommit: null, sourceState: "worktree" };
	}
	const stored = Bun.spawnSync(
		["/usr/bin/git", "show", `${commit}:${sourceRepositoryPath}`],
		{ cwd: repositoryRoot },
	);
	if (stored.exitCode !== 0) {
		return { sourceCommit: null, sourceState: "worktree" };
	}
	if (!equalBytes(stored.stdout, sourceBytes)) {
		return { sourceCommit: null, sourceState: "worktree" };
	}
	return { sourceCommit: commit, sourceState: "committed" };
}

async function run(): Promise<void> {
	const check = process.argv.includes("--check");
	const sourceBytes = new Uint8Array(await Bun.file(sourceUrl).arrayBuffer());
	const artifacts = await buildArtifacts(
		sourceBytes,
		detectProvenance(sourceBytes),
	);
	if (check) {
		const stale = await findStaleArtifacts(artifacts, async (path) => {
			const file = Bun.file(new URL(path, packageRoot));
			return (await file.exists())
				? new Uint8Array(await file.arrayBuffer())
				: null;
		});
		if (stale.length > 0) {
			throw new Error(
				`Mobile gateway artifacts are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun bun run generate.`,
			);
		}
		return;
	}
	for (const artifact of artifacts) {
		await Bun.write(new URL(artifact.path, packageRoot), artifact.bytes);
	}
}

function parametersFor(document: JsonObject, value: unknown): JsonObject[] {
	if (!Array.isArray(value)) return [];
	return value.map((parameter) =>
		resolveComponent(document, parameter, "parameters"),
	);
}

function parameterNames(parameters: JsonObject[], location: string): string[] {
	return parameters
		.filter((parameter) => parameter.in === location)
		.map((parameter) => parameter.name)
		.filter((name): name is string => typeof name === "string")
		.sort((left, right) => left.localeCompare(right, "en"));
}

function requiresAuthentication(value: unknown): boolean {
	if (!Array.isArray(value) || value.length === 0) return false;
	return !value.some(
		(requirement) =>
			isObject(requirement) && Object.keys(requirement).length === 0,
	);
}

function hasJsonRequestBody(document: JsonObject, value: unknown): boolean {
	if (!value) return false;
	const body = resolveComponent(document, value, "requestBodies");
	return isObject(body.content) && "application/json" in body.content;
}

function successResponsesFor(
	document: JsonObject,
	operation: JsonObject,
): SuccessResponseDescriptor[] {
	if (!isObject(operation.responses)) {
		throw new Error(
			`Operation ${String(operation.operationId)} has no responses`,
		);
	}
	const responses: SuccessResponseDescriptor[] = [];
	for (const [statusText, value] of Object.entries(operation.responses)) {
		if (!/^2\d\d$/.test(statusText)) continue;
		const response = resolveComponent(document, value, "responses");
		if (response.content === undefined) {
			responses.push({ status: Number(statusText), contentType: null });
			continue;
		}
		if (!isObject(response.content)) {
			throw new Error(
				`${String(operation.operationId)} ${statusText} has invalid content`,
			);
		}
		const mediaTypes = Object.keys(response.content);
		const jsonContent = response.content["application/json"];
		if (
			mediaTypes.length !== 1 ||
			mediaTypes[0] !== "application/json" ||
			!isObject(jsonContent)
		) {
			throw new Error(
				`${String(operation.operationId)} ${statusText} has unsupported success content`,
			);
		}
		if (!isObject(jsonContent.schema)) {
			throw new Error(
				`${String(operation.operationId)} ${statusText} has no JSON schema`,
			);
		}
		responses.push({
			status: Number(statusText),
			contentType: "application/json",
			schema: stripSchema(jsonContent.schema),
		});
	}
	if (responses.length === 0) {
		throw new Error(
			`Operation ${String(operation.operationId)} has no 2xx response`,
		);
	}
	return responses.sort((left, right) => left.status - right.status);
}

function resolveComponent(
	document: JsonObject,
	value: unknown,
	section: "parameters" | "requestBodies" | "responses",
): JsonObject {
	if (!isObject(value)) throw new Error(`Invalid ${section} entry`);
	if (typeof value.$ref !== "string") return value;
	const match = new RegExp(`^#/components/${section}/([^/]+)$`).exec(
		value.$ref,
	);
	const components = document.components as JsonObject | undefined;
	const entries = components?.[section] as JsonObject | undefined;
	const resolved = match?.[1] ? entries?.[match[1]] : undefined;
	if (!isObject(resolved))
		throw new Error(`Unresolved reference ${value.$ref}`);
	return resolved;
}

const schemaKeywords = new Set([
	"$ref",
	"additionalProperties",
	"anyOf",
	"const",
	"enum",
	"exclusiveMaximum",
	"exclusiveMinimum",
	"format",
	"items",
	"maxItems",
	"maxLength",
	"maximum",
	"minItems",
	"minLength",
	"minimum",
	"oneOf",
	"pattern",
	"properties",
	"required",
	"type",
]);

function stripSchema(schema: JsonObject): JsonObject {
	const stripped: JsonObject = {};
	for (const [key, value] of Object.entries(schema)) {
		if (!schemaKeywords.has(key)) continue;
		if (key === "properties") {
			if (!isObject(value)) throw new Error("Invalid schema properties");
			stripped.properties = Object.fromEntries(
				Object.entries(value).map(([name, child]) => {
					if (!isObject(child)) throw new Error("Invalid property schema");
					return [name, stripSchema(child)];
				}),
			);
			continue;
		}
		if (
			key === "items" ||
			(key === "additionalProperties" && isObject(value))
		) {
			if (!isObject(value)) throw new Error(`Invalid schema ${key}`);
			stripped[key] = stripSchema(value);
			continue;
		}
		if (key === "anyOf" || key === "oneOf") {
			if (!Array.isArray(value) || !value.every(isObject)) {
				throw new Error(`Invalid schema ${key}`);
			}
			stripped[key] = value.map(stripSchema);
			continue;
		}
		stripped[key] = value;
	}
	return stripped;
}

function referencedComponentSchemas(
	document: JsonObject,
	routes: RouteDescriptor[],
): Record<string, JsonObject> {
	const components = document.components as JsonObject | undefined;
	const schemas = components?.schemas as JsonObject | undefined;
	const collected = new Map<string, JsonObject>();
	const visit = (schema: JsonObject): void => {
		const reference = schema.$ref;
		if (typeof reference === "string") {
			const match = /^#\/components\/schemas\/([^/]+)$/.exec(reference);
			const name = match?.[1];
			const target = name ? schemas?.[name] : undefined;
			if (!name || !isObject(target)) {
				throw new Error(`Unresolved schema reference ${reference}`);
			}
			if (!collected.has(name)) {
				const stripped = stripSchema(target);
				collected.set(name, stripped);
				visit(stripped);
			}
		}
		if (isObject(schema.properties)) {
			for (const child of Object.values(schema.properties)) {
				if (isObject(child)) visit(child);
			}
		}
		if (isObject(schema.items)) visit(schema.items);
		if (isObject(schema.additionalProperties)) {
			visit(schema.additionalProperties);
		}
		for (const key of ["anyOf", "oneOf"] as const) {
			const children = schema[key];
			if (Array.isArray(children)) {
				for (const child of children) if (isObject(child)) visit(child);
			}
		}
	};
	for (const route of routes) {
		for (const response of route.successResponses) {
			if (response.schema) visit(response.schema);
		}
	}
	return Object.fromEntries(
		[...collected.entries()].sort(([left], [right]) =>
			left.localeCompare(right, "en"),
		),
	);
}

function renderRoutes(
	routes: RouteDescriptor[],
	componentSchemas: Record<string, JsonObject>,
	digest: string,
): string {
	const operationIds = routes
		.map((route) => JSON.stringify(route.operationId))
		.join(" | ");
	return `/**
 * Generated from contracts/gateway.openapi.json.
 * Pin: sha256:${digest}. Do not edit.
 */
export type GatewayOperationId = ${operationIds};

export interface GatewayJsonSchema {
\treadonly $ref?: string;
\treadonly additionalProperties?: boolean | GatewayJsonSchema;
\treadonly anyOf?: readonly GatewayJsonSchema[];
\treadonly const?: unknown;
\treadonly enum?: readonly unknown[];
\treadonly exclusiveMaximum?: number;
\treadonly exclusiveMinimum?: number;
\treadonly format?: string;
\treadonly items?: GatewayJsonSchema;
\treadonly maxItems?: number;
\treadonly maxLength?: number;
\treadonly maximum?: number;
\treadonly minItems?: number;
\treadonly minLength?: number;
\treadonly minimum?: number;
\treadonly oneOf?: readonly GatewayJsonSchema[];
\treadonly pattern?: string;
\treadonly properties?: Readonly<Record<string, GatewayJsonSchema>>;
\treadonly required?: readonly string[];
\treadonly type?: string | readonly string[];
}

export interface GatewaySuccessResponse {
\treadonly status: number;
\treadonly contentType: "application/json" | null;
\treadonly schema?: GatewayJsonSchema;
}

export interface GatewayRoute {
\treadonly operationId: GatewayOperationId;
\treadonly method: string;
\treadonly path: string;
\treadonly auth: "public" | "required";
\treadonly idempotency: "none" | "required";
\treadonly pathParameters: readonly string[];
\treadonly queryParameters: readonly string[];
\treadonly headerParameters: readonly string[];
\treadonly hasJsonBody: boolean;
\treadonly successResponses: readonly GatewaySuccessResponse[];
}

export const gatewaySchemas: Readonly<Record<string, GatewayJsonSchema>> = ${JSON.stringify(componentSchemas, null, 2)};

export const gatewayRoutes: readonly GatewayRoute[] = ${JSON.stringify(routes, null, 2)};
`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	return left.every((byte, index) => byte === right[index]);
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) await run();
