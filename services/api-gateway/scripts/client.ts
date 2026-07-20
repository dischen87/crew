import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

type JsonObject = Record<string, unknown>;

const root = new URL("../", import.meta.url);
const check = process.argv.includes("--check");
const repository = decodeURIComponent(
	new URL("../../../", import.meta.url).pathname,
);

const sources = [
	{
		name: "user-service",
		source: "../user-service/openapi/openapi.json",
		repositoryPath: "services/user-service/openapi/openapi.json",
		path: new URL("../../user-service/openapi/openapi.json", import.meta.url),
		output: new URL("../contracts/user-service.openapi.json", import.meta.url),
		types: new URL("../src/generated/user-service.ts", import.meta.url),
	},
	{
		name: "event-service",
		source: "../event-service/openapi/openapi.json",
		repositoryPath: "services/event-service/openapi/openapi.json",
		path: new URL("../../event-service/openapi/openapi.json", import.meta.url),
		output: new URL("../contracts/event-service.openapi.json", import.meta.url),
		types: new URL("../src/generated/event-service.ts", import.meta.url),
	},
] as const;

const lockPath = new URL("../contracts/contracts.lock.json", import.meta.url);
const contracts: Record<string, JsonObject> = {};
const artifacts = new Map<URL, string>();

for (const source of sources) {
	const producer = (await Bun.file(source.path).json()) as JsonObject;
	const contract = publicContract(producer);
	const contractText = `${JSON.stringify(contract, null, 2)}\n`;
	const digest = new Bun.CryptoHasher("sha256")
		.update(contractText)
		.digest("hex");
	const sourceCommit = committedSource(source.repositoryPath, contractText);

	contracts[source.name] = {
		digest: `sha256:${digest}`,
		version: (contract.info as JsonObject).version,
		source: source.source,
		sourceCommit,
		sourceState: sourceCommit ? "committed" : "worktree",
	};
	artifacts.set(source.output, contractText);

	const nodes = await openapiTS(contract as unknown as OpenAPI3, {
		alphabetize: true,
		exportType: true,
	});
	artifacts.set(
		source.types,
		`/**\n * Generated from contracts/${source.name}.openapi.json.\n * Pin: sha256:${digest}\n * Generator: openapi-typescript 7.13.0. Do not edit.\n */\n${astToString(nodes)}`,
	);
}

artifacts.set(
	lockPath,
	`${JSON.stringify({ schemaVersion: 2, contracts }, null, 2)}\n`,
);

const stale: string[] = [];
for (const [path, expected] of artifacts) {
	if (check) {
		if (
			!(await Bun.file(path).exists()) ||
			(await Bun.file(path).text()) !== expected
		) {
			stale.push(filePath(path));
		}
	} else {
		await Bun.write(path, expected);
	}
}

if (stale.length > 0) {
	throw new Error(
		`Pinned downstream clients are stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun bun run client:generate.`,
	);
}

function publicContract(document: JsonObject): JsonObject {
	if (document.openapi !== "3.1.0") throw new Error("Expected OpenAPI 3.1.0");
	const paths = Object.fromEntries(
		Object.entries(document.paths as JsonObject).filter(([path]) =>
			path.startsWith("/v1/"),
		),
	);
	const usedSchemas = referencedSchemas(paths);
	const schemas = ((document.components as JsonObject | undefined)?.schemas ??
		{}) as JsonObject;
	for (const name of [...usedSchemas])
		collectSchemaRefs(name, schemas, usedSchemas);
	const tags = new Set<string>();
	visit(paths, (value, key) => {
		if (key === "tags" && Array.isArray(value)) {
			for (const tag of value) if (typeof tag === "string") tags.add(tag);
		}
	});

	const documentTags = Array.isArray(document.tags)
		? (document.tags as JsonObject[])
		: [];
	return {
		openapi: document.openapi,
		info: document.info,
		paths,
		components: {
			schemas: Object.fromEntries(
				Object.entries(schemas).filter(([name]) => usedSchemas.has(name)),
			),
			securitySchemes: Object.fromEntries(
				Object.entries(
					((document.components as JsonObject).securitySchemes ??
						{}) as JsonObject,
				).filter(([name]) => name === "userBearer" || name === "serviceBearer"),
			),
		},
		...(documentTags.length
			? {
					tags: documentTags.filter((tag) => tags.has(String(tag.name))),
				}
			: {}),
	};
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
	schemas: JsonObject,
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

function committedSource(path: string, expected: string): string | null {
	const status = Bun.spawnSync(
		["/usr/bin/git", "status", "--porcelain", "--", path],
		{ cwd: repository },
	);
	if (
		status.exitCode !== 0 ||
		new TextDecoder().decode(status.stdout).trim() !== ""
	) {
		return null;
	}
	const history = Bun.spawnSync(
		["/usr/bin/git", "log", "-1", "--format=%H", "--", path],
		{ cwd: repository },
	);
	const commit = new TextDecoder().decode(history.stdout).trim();
	if (history.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit)) return null;
	const stored = Bun.spawnSync(["/usr/bin/git", "show", `${commit}:${path}`], {
		cwd: repository,
	});
	if (stored.exitCode !== 0) return null;
	try {
		const document = JSON.parse(
			new TextDecoder().decode(stored.stdout),
		) as JsonObject;
		return `${JSON.stringify(publicContract(document), null, 2)}\n` === expected
			? commit
			: null;
	} catch {
		return null;
	}
}

function filePath(path: URL): string {
	return decodeURIComponent(path.pathname).replace(
		decodeURIComponent(root.pathname),
		"",
	);
}
