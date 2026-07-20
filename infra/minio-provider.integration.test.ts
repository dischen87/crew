import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { BunS3PrivateObjectStore } from "../services/event-service/src/object-store";

const endpoint = Bun.env.MINIO_PROVIDER_TEST_ENDPOINT;
const bucket = Bun.env.MINIO_PROVIDER_TEST_BUCKET;
const accessKeyId = Bun.env.MINIO_PROVIDER_TEST_ACCESS_KEY_ID;
const secretAccessKey = Bun.env.MINIO_PROVIDER_TEST_SECRET_ACCESS_KEY;
const metricsToken = Bun.env.MINIO_PROVIDER_TEST_METRICS_TOKEN;

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !metricsToken) {
	test.skip("MinIO provider attestation (set MINIO_PROVIDER_TEST_* variables)", () => {});
} else {
	describe("pinned MinIO provider attachment ingress", () => {
		test("enforces signed multipart fields, privacy and authenticated error metrics", async () => {
			assertLoopback(endpoint);
			const store = new BunS3PrivateObjectStore({
				endpoint,
				region: "us-east-1",
				bucket,
				accessKeyId,
				secretAccessKey,
			});
			const png = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
				"base64",
			);
			const run = `${Date.now()}-${crypto.randomUUID()}`;

			const valid = await grant(store, `quarantine/provider/${run}/valid`, png);
			const validResponse = await upload(valid, png, "image/png");
			expect(validResponse.status).toBe(204);

			const wrongSize = await grant(
				store,
				`quarantine/provider/${run}/wrong-size`,
				png,
			);
			const wrongSizeResponse = await upload(
				wrongSize,
				Buffer.concat([png, Buffer.from([0])]),
				"image/png",
			);
			expect(wrongSizeResponse.status).toBe(400);
			expect(await s3ErrorCode(wrongSizeResponse)).toBe("EntityTooLarge");

			const wrongType = await grant(
				store,
				`quarantine/provider/${run}/wrong-type`,
				png,
			);
			const wrongTypeResponse = await upload(wrongType, png, "image/jpeg", {
				"Content-Type": "image/jpeg",
			});
			expect(wrongTypeResponse.status).toBe(403);
			expect(await s3ErrorCode(wrongTypeResponse)).toBe("AccessDenied");

			const wrongChecksum = await grant(
				store,
				`quarantine/provider/${run}/wrong-checksum`,
				png,
			);
			const changed = Buffer.from(png);
			changed[changed.length - 1] ^= 1;
			const wrongChecksumResponse = await upload(
				wrongChecksum,
				changed,
				"image/png",
			);
			expect(wrongChecksumResponse.status).toBe(400);
			expect(await s3ErrorCode(wrongChecksumResponse)).toBe(
				"XAmzContentChecksumMismatch",
			);

			const publicAcl = await grant(
				store,
				`quarantine/provider/${run}/public-acl`,
				png,
			);
			const publicAclResponse = await upload(publicAcl, png, "image/png", {
				acl: "public-read",
			});
			expect(publicAclResponse.status).toBe(403);
			expect(await s3ErrorCode(publicAclResponse)).toBe("AccessDenied");

			const objectUrl = `${endpoint}/${bucket}/${valid.fields.key}`;
			expect((await fetch(objectUrl, { redirect: "manual" })).status).toBe(403);
			const metricsUrl = `${endpoint}/minio/metrics/v3/bucket/api/${bucket}`;
			expect((await fetch(metricsUrl)).status).toBe(403);
			const metricsResponse = await fetch(metricsUrl, {
				headers: { Authorization: `Bearer ${metricsToken}` },
			});
			expect(metricsResponse.status).toBe(200);
			const metrics = await metricsResponse.text();
			expect(
				metricValue(
					metrics,
					"minio_bucket_api_total",
					'name="PostPolicyBucket"',
				),
			).toBeGreaterThanOrEqual(5);
			expect(
				metricValue(
					metrics,
					"minio_bucket_api_4xx_errors_total",
					'name="PostPolicyBucket"',
				),
			).toBeGreaterThanOrEqual(4);
			expect(
				metricValue(
					metrics,
					"minio_bucket_api_traffic_received_bytes",
					`bucket="${bucket}"`,
				),
			).toBeGreaterThan(0);
		});
	});
}

async function grant(
	store: BunS3PrivateObjectStore,
	key: string,
	bytes: Uint8Array,
) {
	return store.createUploadGrant({
		key,
		contentType: "image/png",
		byteCount: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		expiresAt: new Date(Date.now() + 300_000),
	});
}

async function upload(
	grant: Awaited<ReturnType<typeof grant>>,
	bytes: Uint8Array,
	contentType: string,
	extraFields: Record<string, string> = {},
) {
	const fields = { ...grant.fields, ...extraFields };
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.append(name, value);
	form.append("file", new Blob([bytes], { type: contentType }), "attachment");
	return fetch(grant.url, { method: "POST", body: form, redirect: "manual" });
}

async function s3ErrorCode(response: Response) {
	const body = await response.text();
	return /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
}

function assertLoopback(value: string) {
	const url = new URL(value);
	if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
		throw new Error("MinIO provider attestation requires a loopback endpoint");
	}
}

function metricValue(metrics: string, name: string, label: string) {
	for (const line of metrics.split("\n")) {
		if (!line.startsWith(`${name}{`) || !line.includes(label)) continue;
		const value = Number(line.trim().split(/\s+/).at(-1));
		if (Number.isFinite(value)) return value;
	}
	throw new Error(`Missing finite ${name} metric with ${label}`);
}
