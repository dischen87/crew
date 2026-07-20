import { describe, expect, test } from "bun:test";

const root = new URL("../", import.meta.url);
const composeSource = await Bun.file(new URL("compose.yaml", root)).text();
const compose = object(Bun.YAML.parse(composeSource), "Compose document");
const bootstrap = await Bun.file(
	new URL("infra/minio/bootstrap.sh", root),
).text();
const lifecycle = await Bun.file(
	new URL("infra/minio/lifecycle.json", root),
).json();
const apiPolicy = await Bun.file(
	new URL("infra/minio/api-policy.json", root),
).text();
const workerPolicy = await Bun.file(
	new URL("infra/minio/worker-policy.json", root),
).text();

const serverImage =
	"quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";
const clientImage =
	"minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727";

describe("MinIO attachment ingress boundary", () => {
	test("pins server and client while requiring authenticated metrics", () => {
		const services = object(compose.services, "Compose services");
		const minio = object(services.minio, "MinIO service");
		const minioEnvironment = object(minio.environment, "MinIO environment");
		const bootstrapService = object(
			services["minio-bootstrap"],
			"MinIO bootstrap",
		);
		const bootstrapEnvironment = object(
			bootstrapService.environment,
			"MinIO bootstrap environment",
		);

		expect(minio.image).toBe(serverImage);
		expect(bootstrapService.image).toBe(clientImage);
		expect(minioEnvironment.MINIO_PROMETHEUS_AUTH_TYPE).toBe("jwt");
		expect(bootstrapEnvironment.MINIO_BUCKET_QUOTA).toBe("256MiB");
		expect(composeSource).not.toMatch(/MINIO_PROMETHEUS_AUTH_TYPE:\s*public/);
	});

	test("imports one bounded quarantine lifecycle, quota and private policy", () => {
		expect(lifecycle).toEqual({
			Rules: [
				{
					Expiration: { Days: 1 },
					ID: "crew-quarantine-expiry-v1",
					Filter: { Prefix: "quarantine/" },
					Status: "Enabled",
				},
			],
		});
		expect(bootstrap).toContain("mc anonymous set none");
		expect(bootstrap).toContain("mc ilm rule import");
		expect(bootstrap).toContain("mc quota set");
		expect(bootstrap).toContain("mc admin prometheus generate");
		expect(bootstrap).toContain("--api-version v3");
		expect(bootstrap).not.toContain("--public");
		for (const policy of [apiPolicy, workerPolicy]) {
			expect(policy).not.toContain("s3:PutObjectAcl");
			expect(policy).not.toContain('"Principal"');
			expect(policy).not.toContain('"Action": ["s3:*"]');
		}
	});
});

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Expected ${label} to be an object`);
	}
	return value as Record<string, unknown>;
}
