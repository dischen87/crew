import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { AttachmentUploadRecord } from "./feed-domain";
import {
	BunS3PrivateObjectStore,
	ObjectVerificationError,
	UnsafeQuarantineKeyError,
	UploadGrantCodec,
	verifyAttachmentBytes,
} from "./object-store";

describe("private attachment object validation", () => {
	test("accepts one bounded image and rejects mismatched, truncated, polyglot, animated and bomb inputs", async () => {
		const png = await sharp({
			create: {
				width: 2,
				height: 2,
				channels: 4,
				background: { r: 1, g: 2, b: 3, alpha: 1 },
			},
		})
			.png()
			.toBuffer();
		await expectValidation(png, "image/png").resolves.toBeUndefined();
		await expectValidation(png, "image/jpeg").rejects.toBeInstanceOf(
			ObjectVerificationError,
		);
		await expectValidation(
			png.subarray(0, -4),
			"image/png",
		).rejects.toBeInstanceOf(ObjectVerificationError);
		await expectValidation(
			Buffer.concat([png, Buffer.from("<script>private()</script>")]),
			"image/png",
		).rejects.toBeInstanceOf(ObjectVerificationError);

		const animatedRaw = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
		const animatedWebp = await sharp(animatedRaw, {
			raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
		})
			.webp({ loop: 0 })
			.toBuffer();
		await expectValidation(animatedWebp, "image/webp").rejects.toMatchObject({
			code: "ATTACHMENT_IMAGE_LIMIT_EXCEEDED",
		});

		const bomb = withPngDimensions(png, 100_000, 100_000);
		await expectValidation(bomb, "image/png").rejects.toBeInstanceOf(
			ObjectVerificationError,
		);
	});

	test("binds encrypted POST grants to canonical scope and decrypts the previous KID during rotation", async () => {
		const previousSecret =
			"previous-object-grant-secret-at-least-32-characters";
		const previous = new UploadGrantCodec("previous-v1", previousSecret);
		const current = new UploadGrantCodec(
			"current-v2",
			"current-object-grant-secret-at-least-32-characters",
			[{ kid: "previous-v1", secret: previousSecret }],
		);
		const upload = {
			...uploadRecord(),
			expiresAt: new Date(Date.now() + 300_000),
		};
		const grant = await testStore().createUploadGrant({
			key: upload.quarantineObjectKey,
			contentType: upload.contentType,
			byteCount: upload.byteCount,
			sha256: upload.sha256,
			expiresAt: upload.expiresAt,
		});
		const ciphertext = previous.seal(grant, upload);
		const rotated = {
			...upload,
			grantKid: "previous-v1",
			grantCiphertext: ciphertext,
		};
		expect(current.open(rotated)).toEqual(grant);
		expect(() =>
			current.open({ ...rotated, id: "upl_scope:changed" }),
		).toThrow();
		expect(() =>
			current.open({
				...rotated,
				expiresAt: new Date(upload.expiresAt.getTime() + 1000),
			}),
		).toThrow();
		const invalidGrant = {
			...grant,
			fields: { ...grant.fields },
		};
		delete invalidGrant.fields["x-amz-checksum-sha256"];
		expect(() =>
			current.open({
				...rotated,
				grantCiphertext: previous.seal(invalidGrant, upload),
			}),
		).toThrow();
		expect(ciphertext).not.toContain(grant.fields["X-Amz-Signature"] as string);
	});

	test("refuses committed or drifted keys before quarantine deletion reaches object IO", async () => {
		const store = testStore();
		await expect(
			store.deleteQuarantine({
				key: "committed/evt_one/att_one/upl_one/digest",
				expectedKey: "committed/evt_one/att_one/upl_one/digest",
			}),
		).rejects.toBeInstanceOf(UnsafeQuarantineKeyError);
		await expect(
			store.deleteQuarantine({
				key: "quarantine/evt_one/att_one/upl_one/bytes-digest",
				expectedKey: "quarantine/evt_two/att_one/upl_one/bytes-digest",
			}),
		).rejects.toBeInstanceOf(UnsafeQuarantineKeyError);
	});

	test("encodes an exact signed POST policy without claiming a provider live rejection", async () => {
		const store = testStore();
		const now = Date.now();
		const digest = "a".repeat(64);
		const checksum = Buffer.from(digest, "hex").toString("base64");
		const grant = await store.createUploadGrant({
			key: "quarantine/evt_1/att_1/upl_1/spec",
			contentType: "image/png",
			byteCount: 12,
			sha256: digest,
			expiresAt: new Date(now + 300_000),
		});
		const url = new URL(grant.url);
		expect(grant.method).toBe("POST");
		expect(url.protocol).toBe("https:");
		expect(Object.keys(grant.fields).sort()).toEqual(
			[
				"Content-Type",
				"Policy",
				"X-Amz-Algorithm",
				"X-Amz-Credential",
				"X-Amz-Date",
				"X-Amz-Signature",
				"bucket",
				"key",
				"x-amz-checksum-algorithm",
				"x-amz-checksum-sha256",
			].sort(),
		);
		expect(grant.fields).toMatchObject({
			key: "quarantine/evt_1/att_1/upl_1/spec",
			"Content-Type": "image/png",
			"x-amz-checksum-algorithm": "SHA256",
			"x-amz-checksum-sha256": checksum,
			bucket: "crew-private-test",
			"X-Amz-Algorithm": "AWS4-HMAC-SHA256",
		});
		const policy = decodePolicy(grant.fields.Policy as string);
		expect(policy).toEqual({
			expiration: expect.any(String),
			conditions: [
				["content-length-range", 12, 12],
				{ "Content-Type": "image/png" },
				{ "x-amz-checksum-algorithm": "SHA256" },
				{ "x-amz-checksum-sha256": checksum },
				{ bucket: "crew-private-test" },
				{ "X-Amz-Algorithm": grant.fields["X-Amz-Algorithm"] },
				{ "X-Amz-Credential": grant.fields["X-Amz-Credential"] },
				{ "X-Amz-Date": grant.fields["X-Amz-Date"] },
				{ key: "quarantine/evt_1/att_1/upl_1/spec" },
			],
		});
		expect(new Date(policy.expiration).getTime() - now).toBeWithin(
			298_000,
			301_000,
		);
		expect(policyAllows(policy, 12, grant.fields)).toBe(true);
		expect(policyAllows(policy, 13, grant.fields)).toBe(false);
		expect(
			policyAllows(policy, 12, {
				...grant.fields,
				"Content-Type": "image/jpeg",
			}),
		).toBe(false);
		expect(
			policyAllows(policy, 12, {
				...grant.fields,
				"x-amz-checksum-sha256": Buffer.from("b".repeat(64), "hex").toString(
					"base64",
				),
			}),
		).toBe(false);

		const download = await store.createDownloadGrant({
			key: "committed/evt_1/att_1/upl_1/spec",
			expiresAt: new Date(Date.now() + 60_000),
		});
		expect(download).toMatchObject({ method: "GET", headers: {} });
	});
});

type PostPolicy = { expiration: string; conditions: unknown[] };

function testStore() {
	return new BunS3PrivateObjectStore({
		endpoint: "https://objects.test",
		region: "us-east-1",
		bucket: "crew-private-test",
		accessKeyId: "test-access-key",
		secretAccessKey: "test-secret-key-at-least-16",
	});
}

function decodePolicy(value: string): PostPolicy {
	return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

function policyAllows(
	policy: PostPolicy,
	byteCount: number,
	fields: Record<string, string>,
) {
	return policy.conditions.every((condition) => {
		if (Array.isArray(condition)) {
			return (
				condition[0] === "content-length-range" &&
				byteCount >= Number(condition[1]) &&
				byteCount <= Number(condition[2])
			);
		}
		if (!condition || typeof condition !== "object") return false;
		return Object.entries(condition).every(
			([name, value]) => fields[name] === value,
		);
	});
}

function expectValidation(
	bytes: Uint8Array,
	contentType: "image/jpeg" | "image/png" | "image/webp",
) {
	return expect(
		verifyAttachmentBytes(bytes, {
			contentType,
			byteCount: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		}),
	);
}

function uploadRecord(): AttachmentUploadRecord {
	return {
		id: "upl_scope:one",
		attachmentId: "att_scope:one",
		rootEventId: "evt_scope:one",
		target: { kind: "feedEntry", entryId: "fed_scope:one" },
		targetEntryId: "fed_scope:one",
		createdBy: `usr_${"1".repeat(32)}`,
		quarantineObjectKey: "quarantine/evt_scope:one/upl_scope:one",
		contentType: "image/png",
		byteCount: 12,
		sha256: "a".repeat(64),
		grantKid: "unused",
		grantCiphertext: "unused",
		state: "prepared",
		expiresAt: new Date("2030-01-01T00:00:00.000Z"),
		committedAt: null,
		createdAt: new Date("2029-12-31T23:55:00.000Z"),
	};
}

function withPngDimensions(source: Buffer, width: number, height: number) {
	const value = Buffer.from(source);
	value.writeUInt32BE(width, 16);
	value.writeUInt32BE(height, 20);
	value.writeUInt32BE(crc32(value.subarray(12, 29)), 29);
	return value;
}

function crc32(value: Uint8Array) {
	let crc = 0xffffffff;
	for (const byte of value) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
