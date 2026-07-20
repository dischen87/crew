import { describe, expect, test } from "bun:test";

const root = new URL("../", import.meta.url);
const dockerfile = await Bun.file(
	new URL("infra/redis/Dockerfile", root),
).text();
const startup = await Bun.file(new URL("infra/redis/start.sh", root)).text();
const compose = object(
	Bun.YAML.parse(await Bun.file(new URL("compose.yaml", root)).text()),
	"Compose document",
);

const redisImage =
	"redis:8.8.0-alpine@sha256:9d317178eceac8454a2284a9e6df2466b93c745529947f0cd42a0fa9609d7005";
const allowedCommands = [
	"select",
	"ping",
	"eval",
	"time",
	"zremrangebyscore",
	"pttl",
	"zcard",
	"zrange",
	"set",
	"zadd",
	"pexpireat",
	"get",
	"incr",
];

describe("rate-limit Redis image", () => {
	test("pins the official image and drops root", () => {
		expect(dockerfile).toContain(`FROM ${redisImage}`);
		expect(dockerfile).not.toMatch(/latest/i);
		expect(dockerfile).toContain("USER redis");
		expect(dockerfile).toContain('ENTRYPOINT ["/usr/local/bin/crew-redis"]');
	});

	test("persists every accepted counter and never evicts active windows", () => {
		expect(startup).toContain("--appendonly yes");
		expect(startup).toContain("--appendfsync always");
		expect(startup).toContain("--maxmemory-policy noeviction");
		expect(startup).toContain('--save ""');
	});

	test("uses exact service-owned ACL namespaces and commands", () => {
		const lines = startup.split("\n");
		const defaultUser = lines.find((line) => line.includes("user default off"));
		expect(defaultUser).toContain("resetkeys");
		expect(defaultUser).toContain("-@all");

		for (const [user, namespace] of [
			["crew_gateway", "~crew:gateway:rate:v1:*"],
			["crew_user", "~crew:user:rate:v1:*"],
		] as const) {
			const line = lines.find((candidate) =>
				candidate.includes(`user ${user} reset on`),
			);
			expect(line).toBeDefined();
			expect(line).toContain(namespace);
			expect(line).toContain("resetchannels -@all");
			expect(line).not.toContain("~*");
			expect(line).not.toContain("+@all");
			expect(
				line
					?.replaceAll('"', "")
					?.split(" ")
					.filter((token) => token.startsWith("+"))
					.map((token) => token.slice(1)),
			).toEqual(allowedCommands);
		}
	});

	test("wires distinct ACL users and secret domains through hardened Compose", () => {
		const services = object(compose.services, "Compose services");
		const redis = object(services["redis-rate-limit"], "Redis service");
		const redisBuild = object(redis.build, "Redis build");
		const redisEnvironment = object(redis.environment, "Redis environment");
		expect(redis.image).toBe("crew-local-rate-limit-redis:8.8.0");
		expect(redisBuild.dockerfile).toBe("infra/redis/Dockerfile");
		expect(redis.read_only).toBe(true);
		expect(redis.cap_drop).toEqual(["ALL"]);
		expect(redis.security_opt).toEqual(["no-new-privileges:true"]);
		expect(redis.ports).toEqual([
			["127.0.0.1:", "$", "{REDIS_HOST_PORT:-6380}:6379"].join(""),
		]);
		expect(redis.volumes).toEqual(["redis_rate_limit_data:/data"]);
		expect(Object.keys(redisEnvironment).sort()).toEqual([
			"REDIS_GATEWAY_PASSWORD",
			"REDIS_USER_PASSWORD",
		]);

		const gateway = object(services["api-gateway"], "Gateway service");
		const user = object(services["user-api"], "User service");
		const gatewayEnvironment = object(
			gateway.environment,
			"Gateway environment",
		);
		const userEnvironment = object(user.environment, "User environment");
		expect(gatewayEnvironment.RATE_LIMIT_REDIS_URL).toContain(
			"redis://crew_gateway:",
		);
		expect(userEnvironment.RATE_LIMIT_REDIS_URL).toContain(
			"redis://crew_user:",
		);
		expect(gatewayEnvironment.RATE_LIMIT_REDIS_URL).not.toBe(
			userEnvironment.RATE_LIMIT_REDIS_URL,
		);
		expect(gatewayEnvironment.RATE_LIMIT_KEY).not.toBe(
			userEnvironment.RATE_LIMIT_KEY,
		);
		expect(
			object(
				object(gateway.depends_on, "Gateway dependencies")["redis-rate-limit"],
				"Gateway Redis dependency",
			).condition,
		).toBe("service_healthy");
		expect(
			object(
				object(user.depends_on, "User dependencies")["redis-rate-limit"],
				"User Redis dependency",
			).condition,
		).toBe("service_healthy");
		expect(object(compose.volumes, "Compose volumes")).toHaveProperty(
			"redis_rate_limit_data",
		);
	});
});

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected ${label} to be an object`);
	}
	return value as Record<string, unknown>;
}
