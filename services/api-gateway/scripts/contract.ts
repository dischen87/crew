import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";
import { MemoryRateLimiter } from "../src/security";

const path = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));
const response = await createApp({
	rateLimiter: new MemoryRateLimiter(1, 1_000, 1),
}).request("/docs/openapi.json");
const output = `${JSON.stringify(await response.json(), null, 2)}\n`;

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
