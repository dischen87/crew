import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import contractLock from "../contracts/contracts.lock.json";
import eventContract from "../contracts/event-service.openapi.json";
import userContract from "../contracts/user-service.openapi.json";
import type {
	operations as EventOperations,
	paths as EventPaths,
} from "./generated/event-service";
import type {
	operations as UserOperations,
	paths as UserPaths,
} from "./generated/user-service";

type JsonObject = Record<string, unknown>;
type DownstreamPath =
	| Extract<keyof UserPaths, `/v1/${string}`>
	| Extract<keyof EventPaths, `/v1/${string}`>;
type PublicPath = DownstreamPath extends infer Path
	? Path extends `/v1/${infer Rest}`
		? `/core/v1/${Rest}`
		: never
	: never;
type PublicOperationId = keyof UserOperations | keyof EventOperations;
type Service = "user-service" | "event-service";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ProxyRoute = {
	service: Service;
	publicPath: PublicPath;
	downstreamPath: DownstreamPath;
	method: Method;
	operationId: PublicOperationId;
	auth: "public" | "user" | "service";
	composeOnly: boolean;
	maxRequestBytes: number;
	hasRequestBody: boolean;
	requestBodyRequired: boolean;
	parameters: ReadonlyArray<ProxyParameter>;
	matcher: RegExp;
};

export type ProxyParameter = {
	name: string;
	in: "path" | "query" | "header";
	required: boolean;
	schema: JsonObject;
};

type Contract = {
	openapi: string;
	info: { title: string; version: string };
	paths: Record<string, Record<string, JsonObject>>;
	components: { schemas: Record<string, unknown> };
	tags?: JsonObject[];
};

const MAX_BODY_BYTES = 1_048_576;
const methods = ["get", "post", "put", "patch", "delete"] as const;
const contracts = {
	"user-service": userContract as Contract,
	"event-service": eventContract as Contract,
} as const;
const routes = Object.entries(contracts)
	.flatMap(([service, contract]) =>
		contractRoutes(service as Service, contract),
	)
	.sort(
		(left, right) =>
			routeSpecificity(right.publicPath) - routeSpecificity(left.publicPath),
	);
const routeOperations = new Map(
	routes.map((route) => [
		routeKey(route),
		contracts[route.service].paths[route.downstreamPath]?.[
			route.method.toLowerCase()
		],
	]),
);
const validators = new Map<string, ValidateFunction>();
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const parameterValidators = new Map<string, ValidateFunction>();
const parameterAjv = new Ajv2020({
	allErrors: true,
	coerceTypes: true,
	strict: false,
});
addFormats(parameterAjv);

export function findProxyRoute(
	method: string,
	path: string,
): ProxyRoute | undefined {
	const normalized = method.toUpperCase();
	return routes.find(
		(route) =>
			!route.composeOnly &&
			route.method === normalized &&
			route.matcher.test(path),
	);
}

export function findComposeRoute(operationId: string): ProxyRoute {
	const matches = routes.filter(
		(route) => route.composeOnly && route.operationId === operationId,
	);
	if (matches.length !== 1) {
		throw new Error(`Expected one compose-only route for ${operationId}`);
	}
	return matches[0] as ProxyRoute;
}

export function responseContract(
	route: ProxyRoute,
	status: number,
):
	| { kind: "empty" }
	| { kind: "json"; validate: ValidateFunction }
	| undefined {
	const operation = routeOperations.get(routeKey(route));
	const response = (operation?.responses as JsonObject | undefined)?.[
		String(status)
	] as JsonObject | undefined;
	if (!response) return;
	const content = response.content as JsonObject | undefined;
	if (!content) return { kind: "empty" };
	const media = content["application/json"] as JsonObject | undefined;
	const schema = media?.schema as JsonObject | undefined;
	if (!schema) return;

	return {
		kind: "json",
		validate: schemaValidator(route, `response:${status}`, schema),
	};
}

export function requestBodyContract(
	route: ProxyRoute,
): ValidateFunction | undefined {
	const operation = routeOperations.get(routeKey(route));
	const requestBody = operation?.requestBody as JsonObject | undefined;
	const content = requestBody?.content as JsonObject | undefined;
	const media = content?.["application/json"] as JsonObject | undefined;
	const schema = media?.schema as JsonObject | undefined;
	return schema ? schemaValidator(route, "request", schema) : undefined;
}

export function parameterValidator(
	route: ProxyRoute,
	parameter: ProxyParameter,
): ValidateFunction {
	const key = `${routeKey(route)}:parameter:${parameter.in}:${parameter.name}`;
	let validate = parameterValidators.get(key);
	if (!validate) {
		validate = parameterAjv.compile({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			...parameter.schema,
			components: contracts[route.service].components,
		});
		parameterValidators.set(key, validate);
	}
	return validate;
}

export function gatewayContract(base: object): JsonObject {
	const output = structuredClone(base) as JsonObject;
	output.paths ??= {};
	const paths = output.paths as JsonObject;
	output.components ??= {};
	const components = output.components as JsonObject;
	components.schemas ??= {};
	const schemas = components.schemas as JsonObject;
	const tags = new Map<string, JsonObject>();
	for (const tag of (output.tags as JsonObject[] | undefined) ?? []) {
		tags.set(String(tag.name), tag);
	}

	for (const [service, contract] of Object.entries(contracts)) {
		const prefix = service === "user-service" ? "UserService" : "EventService";
		const exposedPaths = Object.entries(contract.paths).filter(
			([, pathItem]) => !composeOnlyPath(pathItem),
		);
		for (const [downstreamPath, pathItem] of exposedPaths) {
			const publicPath = toPublicPath(downstreamPath);
			if (paths[publicPath])
				throw new Error(`Duplicate gateway path ${publicPath}`);
			const publicPathItem = rewriteRefs(pathItem, prefix) as JsonObject;
			for (const method of methods) {
				const operation = publicPathItem[method] as JsonObject | undefined;
				if (!operation) continue;
				const responses = operation.responses as JsonObject;
				if (
					operation.operationId !== "eventRecapShareLinksResolve" &&
					operation.operationId !== "eventRecapExternalShareLinksResolve"
				) {
					responses["400"] ??= edgeError("Invalid request");
				}
				responses["413"] ??= edgeError("Payload too large");
				if (operation.requestBody) {
					responses["415"] ??= edgeError("Unsupported media type");
				}
				responses["429"] ??= edgeError("Rate limited", true);
				responses["502"] ??= edgeError("Invalid upstream response");
				responses["503"] ??= edgeError("Required service unavailable");
				responses["504"] ??= edgeError("Required service timeout");
			}
			paths[publicPath] = publicPathItem;
		}
		const usedSchemas = referencedSchemas(Object.fromEntries(exposedPaths));
		for (const name of [...usedSchemas]) {
			collectSchemaRefs(name, contract.components.schemas, usedSchemas);
		}
		for (const [name, schema] of Object.entries(contract.components.schemas)) {
			if (!usedSchemas.has(name)) continue;
			schemas[`${prefix}${name}`] = rewriteRefs(schema, prefix);
		}
		const usedTags = referencedTags(Object.fromEntries(exposedPaths));
		for (const tag of contract.tags ?? []) {
			if (usedTags.has(String(tag.name))) tags.set(String(tag.name), tag);
		}
	}

	output.tags = [...tags.values()];
	output["x-downstream-contracts"] = contractLock.contracts;
	return output;
}

function edgeError(description: string, retryAfter = false): JsonObject {
	return {
		description,
		headers: {
			"X-Request-ID": {
				description: "Crew request correlation identifier",
				schema: { type: "string" },
			},
			...(retryAfter
				? {
						"Retry-After": {
							description: "Seconds until this request may be retried",
							schema: { type: "string" },
						},
					}
				: {}),
		},
		content: {
			"application/json": {
				schema: { $ref: "#/components/schemas/ErrorEnvelope" },
			},
		},
	};
}

function contractRoutes(service: Service, contract: Contract): ProxyRoute[] {
	const result: ProxyRoute[] = [];
	for (const [path, pathItem] of Object.entries(contract.paths)) {
		if (!path.startsWith("/v1/"))
			throw new Error(`Non-public route pinned: ${path}`);
		for (const method of methods) {
			const operation = pathItem[method];
			if (!operation) continue;
			const operationId = operation.operationId;
			if (typeof operationId !== "string") {
				throw new Error(
					`Missing operationId for ${method.toUpperCase()} ${path}`,
				);
			}
			const security = operation.security;
			const securityName =
				Array.isArray(security) && security.length === 1
					? Object.keys((security[0] as JsonObject | undefined) ?? {})[0]
					: undefined;
			const auth =
				Array.isArray(security) && security.length === 0
					? "public"
					: securityName === "userBearer"
						? "user"
						: securityName === "serviceBearer"
							? "service"
							: undefined;
			const composeOnly = operation["x-gateway-compose-only"] === true;
			if (!auth || (auth === "service" && !composeOnly)) {
				throw new Error(`Unsupported security for ${operationId}`);
			}
			result.push({
				service,
				publicPath: toPublicPath(path) as PublicPath,
				downstreamPath: path as DownstreamPath,
				method: method.toUpperCase() as Method,
				operationId: operationId as PublicOperationId,
				auth,
				composeOnly,
				maxRequestBytes:
					typeof operation["x-max-decoded-body-bytes"] === "number"
						? operation["x-max-decoded-body-bytes"]
						: MAX_BODY_BYTES,
				hasRequestBody: operation.requestBody !== undefined,
				requestBodyRequired:
					typeof operation.requestBody === "object" &&
					operation.requestBody !== null &&
					(operation.requestBody as JsonObject).required === true,
				parameters: requestParameters(pathItem, operation),
				matcher: pathMatcher(toPublicPath(path)),
			});
		}
	}
	return result;
}

function composeOnlyPath(pathItem: Record<string, JsonObject>): boolean {
	const operations = methods.flatMap((method) =>
		pathItem[method] ? [pathItem[method]] : [],
	);
	const composeOnly = operations.filter(
		(operation) => operation["x-gateway-compose-only"] === true,
	);
	if (composeOnly.length > 0 && composeOnly.length !== operations.length) {
		throw new Error("Compose-only and public operations cannot share a path");
	}
	return composeOnly.length > 0;
}

function requestParameters(
	pathItem: Record<string, JsonObject>,
	operation: JsonObject,
): ProxyParameter[] {
	const merged = new Map<string, ProxyParameter>();
	for (const value of [pathItem.parameters, operation.parameters]) {
		if (value === undefined) continue;
		if (!Array.isArray(value)) throw new Error("Invalid OpenAPI parameters");
		for (const candidate of value) {
			if (!candidate || typeof candidate !== "object" || "$ref" in candidate) {
				throw new Error("Referenced parameters are not supported");
			}
			const parameter = candidate as JsonObject;
			const location = parameter.in;
			if (
				location !== "path" &&
				location !== "query" &&
				location !== "header"
			) {
				throw new Error(`Unsupported parameter location ${String(location)}`);
			}
			if (typeof parameter.name !== "string") {
				throw new Error("OpenAPI parameter is missing a name");
			}
			if (!parameter.schema || typeof parameter.schema !== "object") {
				throw new Error(`OpenAPI parameter ${parameter.name} has no schema`);
			}
			const normalized = {
				name:
					location === "header" ? parameter.name.toLowerCase() : parameter.name,
				in: location,
				required: parameter.required === true,
				schema: parameter.schema as JsonObject,
			} satisfies ProxyParameter;
			merged.set(`${normalized.in}:${normalized.name}`, normalized);
		}
	}
	return [...merged.values()];
}

function pathMatcher(path: string): RegExp {
	const pattern = path
		.split("/")
		.map((segment) =>
			segment.startsWith("{") && segment.endsWith("}")
				? "[^/]+"
				: segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("/");
	return new RegExp(`^${pattern}$`);
}

function routeSpecificity(path: string): number {
	return path
		.split("/")
		.reduce((score, segment) => score + (segment.startsWith("{") ? 1 : 10), 0);
}

function routeKey(
	route: Pick<ProxyRoute, "service" | "downstreamPath" | "method">,
): string {
	return `${route.service}:${route.method}:${route.downstreamPath}`;
}

function schemaValidator(
	route: ProxyRoute,
	kind: string,
	schema: JsonObject,
): ValidateFunction {
	const key = `${routeKey(route)}:${kind}`;
	let validate = validators.get(key);
	if (!validate) {
		validate = ajv.compile({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			...schema,
			components: contracts[route.service].components,
		});
		validators.set(key, validate);
	}
	return validate;
}

function toPublicPath(path: string): string {
	if (!path.startsWith("/v1/"))
		throw new Error(`Invalid downstream path ${path}`);
	return `/core${path}`;
}

function rewriteRefs<T>(value: T, prefix: string): T {
	if (Array.isArray(value))
		return value.map((item) => rewriteRefs(item, prefix)) as T;
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, child]) => [
			key,
			key === "$ref" && typeof child === "string"
				? child.replace(
						"#/components/schemas/",
						`#/components/schemas/${prefix}`,
					)
				: rewriteRefs(child, prefix),
		]),
	) as T;
}

function referencedSchemas(value: unknown): Set<string> {
	const names = new Set<string>();
	visit(value, (candidate, key) => {
		if (key !== "$ref" || typeof candidate !== "string") return;
		const match = /^#\/components\/schemas\/([^/]+)$/.exec(candidate);
		if (match?.[1]) names.add(match[1]);
	});
	return names;
}

function collectSchemaRefs(
	name: string,
	schemas: Record<string, unknown>,
	used: Set<string>,
): void {
	const schema = schemas[name];
	if (!schema) throw new Error(`Missing referenced schema ${name}`);
	for (const dependency of referencedSchemas(schema)) {
		if (used.has(dependency)) continue;
		used.add(dependency);
		collectSchemaRefs(dependency, schemas, used);
	}
}

function referencedTags(value: unknown): Set<string> {
	const names = new Set<string>();
	visit(value, (candidate, key) => {
		if (key !== "tags" || !Array.isArray(candidate)) return;
		for (const tag of candidate) {
			if (typeof tag === "string") names.add(tag);
		}
	});
	return names;
}

function visit(
	value: unknown,
	callback: (value: unknown, key: string) => void,
): void {
	if (Array.isArray(value)) {
		for (const item of value) visit(item, callback);
		return;
	}
	if (!value || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		callback(child, key);
		visit(child, callback);
	}
}
