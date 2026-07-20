import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import sharp from "sharp";
import type {
	AttachmentContentType,
	AttachmentTarget,
	AttachmentUploadRecord,
	DownloadGrant,
	UploadGrant,
} from "./feed-domain";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

export type UploadObjectSpec = {
	quarantineKey: string;
	committedKey: string;
	contentType: AttachmentContentType;
	byteCount: number;
	sha256: string;
};

export type QuarantineDeleteSpec = {
	key: string;
	expectedKey: string;
};

export type CommittedFeedbackDeleteSpec = {
	key: string;
	expectedKey: string;
};

export interface AttachmentApiObjectStore {
	createUploadGrant(input: {
		key: string;
		contentType: AttachmentContentType;
		byteCount: number;
		sha256: string;
		expiresAt: Date;
	}): Promise<UploadGrant>;
	createDownloadGrant(input: {
		key: string;
		expiresAt: Date;
	}): Promise<DownloadGrant>;
}

export interface AttachmentWorkerObjectStore {
	verifyAndCommit(input: UploadObjectSpec, signal?: AbortSignal): Promise<void>;
	deleteQuarantine(
		input: QuarantineDeleteSpec,
		signal?: AbortSignal,
	): Promise<void>;
	deleteCommittedFeedback(
		input: CommittedFeedbackDeleteSpec,
		signal?: AbortSignal,
	): Promise<void>;
}

export interface PrivateObjectStore
	extends AttachmentApiObjectStore,
		AttachmentWorkerObjectStore {}

export class BunS3PrivateObjectStore implements PrivateObjectStore {
	private readonly client: Bun.S3Client;
	private readonly postClient: S3Client;
	private readonly bucket: string;
	private readonly gate: ConcurrencyGate;

	constructor(options: Bun.S3Options, maxConcurrentVerifications = 2) {
		const { bucket, region, accessKeyId, secretAccessKey } = options;
		if (!bucket || !region || !accessKeyId || !secretAccessKey)
			throw new Error(
				"Complete private object-store configuration is required",
			);
		this.client = new Bun.S3Client(options);
		this.postClient = new S3Client({
			...(options.endpoint ? { endpoint: options.endpoint } : {}),
			region,
			forcePathStyle: true,
			credentials: {
				accessKeyId,
				secretAccessKey,
				...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
			},
		});
		this.bucket = bucket;
		this.gate = new ConcurrencyGate(maxConcurrentVerifications);
	}

	async createUploadGrant(input: {
		key: string;
		contentType: AttachmentContentType;
		byteCount: number;
		sha256: string;
		expiresAt: Date;
	}): Promise<UploadGrant> {
		const expiresIn = secondsUntil(input.expiresAt);
		const checksum = sha256Base64(input.sha256);
		const fields = {
			"Content-Type": input.contentType,
			"x-amz-checksum-algorithm": "SHA256",
			"x-amz-checksum-sha256": checksum,
		};
		const signed = await createPresignedPost(this.postClient, {
			Bucket: this.bucket,
			Key: input.key,
			Expires: expiresIn,
			Fields: fields,
			Conditions: [
				["content-length-range", input.byteCount, input.byteCount],
				{ "Content-Type": input.contentType },
				{ "x-amz-checksum-algorithm": "SHA256" },
				{ "x-amz-checksum-sha256": checksum },
			],
		});
		return {
			method: "POST",
			url: signed.url,
			fields: signed.fields,
			expiresAt: input.expiresAt,
		};
	}

	verifyAndCommit(
		input: UploadObjectSpec,
		signal?: AbortSignal,
	): Promise<void> {
		return this.gate.run(async () => {
			signal?.throwIfAborted();
			if (input.byteCount > MAX_ATTACHMENT_BYTES)
				throw new ObjectVerificationError("ATTACHMENT_TOO_LARGE");
			const bytes = await this.readBounded(
				input.quarantineKey,
				input.byteCount,
				signal,
			);
			await verifyAttachmentBytes(bytes, input);
			signal?.throwIfAborted();

			await this.client.write(input.committedKey, bytes, {
				type: input.contentType,
			});
			signal?.throwIfAborted();
			const committed = await this.readBounded(
				input.committedKey,
				input.byteCount,
				signal,
			);
			if (sha256(committed) !== input.sha256)
				throw new ObjectVerificationError("ATTACHMENT_COMMIT_MISMATCH");
		});
	}

	async deleteQuarantine(
		input: QuarantineDeleteSpec,
		signal?: AbortSignal,
	): Promise<void> {
		signal?.throwIfAborted();
		if (
			input.key !== input.expectedKey ||
			!input.key.startsWith("quarantine/") ||
			input.key.startsWith("committed/")
		)
			throw new UnsafeQuarantineKeyError();
		await this.client.delete(input.key);
		signal?.throwIfAborted();
	}

	async deleteCommittedFeedback(
		input: CommittedFeedbackDeleteSpec,
		signal?: AbortSignal,
	): Promise<void> {
		signal?.throwIfAborted();
		if (
			input.key !== input.expectedKey ||
			!input.key.startsWith("committed/") ||
			input.key.startsWith("quarantine/")
		)
			throw new UnsafeCommittedFeedbackKeyError();
		await this.client.delete(input.key);
		signal?.throwIfAborted();
	}

	async createDownloadGrant(input: {
		key: string;
		expiresAt: Date;
	}): Promise<DownloadGrant> {
		return {
			method: "GET",
			url: this.client.presign(input.key, {
				method: "GET",
				expiresIn: secondsUntil(input.expiresAt),
			}),
			headers: {},
			expiresAt: input.expiresAt,
		};
	}

	private async readBounded(
		key: string,
		expectedBytes: number,
		signal?: AbortSignal,
	) {
		signal?.throwIfAborted();
		const stat = await this.client.stat(key);
		signal?.throwIfAborted();
		if (stat.size !== expectedBytes || stat.size > MAX_ATTACHMENT_BYTES)
			throw new ObjectVerificationError("ATTACHMENT_SIZE_MISMATCH");
		const reader = this.client.file(key).stream().getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			for (;;) {
				signal?.throwIfAborted();
				const { done, value } = await reader.read();
				if (done) break;
				length += value.byteLength;
				if (length > expectedBytes || length > MAX_ATTACHMENT_BYTES)
					throw new ObjectVerificationError("ATTACHMENT_SIZE_MISMATCH");
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		if (length !== expectedBytes)
			throw new ObjectVerificationError("ATTACHMENT_SIZE_MISMATCH");
		return Buffer.concat(chunks, length);
	}
}

export class ObjectVerificationError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

export class UnsafeQuarantineKeyError extends Error {
	constructor() {
		super("ATTACHMENT_CLEANUP_KEY_INVALID");
	}
}

export class UnsafeCommittedFeedbackKeyError extends Error {
	constructor() {
		super("FEEDBACK_ATTACHMENT_CLEANUP_KEY_INVALID");
	}
}

const permanentVerificationCodes = new Set([
	"ATTACHMENT_TOO_LARGE",
	"ATTACHMENT_SIZE_MISMATCH",
	"ATTACHMENT_CHECKSUM_MISMATCH",
	"ATTACHMENT_TYPE_MISMATCH",
	"ATTACHMENT_IMAGE_LIMIT_EXCEEDED",
	"ATTACHMENT_DECODE_FAILED",
]);

export function isPermanentObjectVerificationError(
	error: unknown,
): error is ObjectVerificationError {
	return (
		error instanceof ObjectVerificationError &&
		permanentVerificationCodes.has(error.code)
	);
}

export class UploadGrantCodec {
	private readonly keys: Map<string, Buffer>;

	constructor(
		readonly kid: string,
		secret: string,
		previous: Array<{ kid: string; secret: string }> = [],
	) {
		this.keys = new Map(
			[{ kid, secret }, ...previous].map((value) => [
				value.kid,
				deriveGrantKey(value.secret),
			]),
		);
		if (this.keys.size !== previous.length + 1)
			throw new Error("Upload grant key IDs must be unique");
	}

	seal(grant: UploadGrant, upload: UploadGrantScope) {
		const iv = randomBytes(12);
		const key = this.keys.get(this.kid);
		if (!key) throw new Error("Current upload grant key is unavailable");
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(Buffer.from(grantAad(upload)));
		const ciphertext = Buffer.concat([
			cipher.update(
				JSON.stringify({
					method: grant.method,
					url: grant.url,
					fields: grant.fields,
					expiresAt: grant.expiresAt.toISOString(),
				}),
				"utf8",
			),
			cipher.final(),
		]);
		return [iv, cipher.getAuthTag(), ciphertext]
			.map((value) => value.toString("base64url"))
			.join(".");
	}

	open(upload: AttachmentUploadRecord): UploadGrant {
		const key = this.keys.get(upload.grantKid);
		if (!key) throw new Error("Unknown upload grant key");
		const parts = upload.grantCiphertext.split(".");
		if (parts.length !== 3) throw new Error("Invalid upload grant ciphertext");
		const [ivText, tagText, ciphertextText] = parts;
		if (!ivText || !tagText || !ciphertextText)
			throw new Error("Invalid upload grant ciphertext");
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			Buffer.from(ivText, "base64url"),
		);
		decipher.setAAD(Buffer.from(grantAad(upload)));
		decipher.setAuthTag(Buffer.from(tagText, "base64url"));
		const value: unknown = JSON.parse(
			Buffer.concat([
				decipher.update(Buffer.from(ciphertextText, "base64url")),
				decipher.final(),
			]).toString("utf8"),
		);
		if (!validUploadGrant(value, upload))
			throw new Error("Invalid upload grant envelope");
		return {
			method: "POST",
			url: value.url,
			fields: value.fields,
			expiresAt: new Date(value.expiresAt),
		};
	}
}

type UploadGrantScope = Pick<
	AttachmentUploadRecord,
	| "id"
	| "attachmentId"
	| "rootEventId"
	| "target"
	| "targetEntryId"
	| "quarantineObjectKey"
	| "contentType"
	| "byteCount"
	| "sha256"
>;

function grantAad(upload: UploadGrantScope) {
	const target = grantTargetAad(upload.target);
	return JSON.stringify([
		"crew:event-upload-grant:v2",
		upload.rootEventId,
		upload.id,
		upload.attachmentId,
		target,
		upload.quarantineObjectKey,
		upload.contentType,
		String(upload.byteCount),
		upload.sha256,
	]);
}

function grantTargetAad(target: AttachmentTarget) {
	return target.kind === "feedEntry"
		? target.entryId
		: `feedback:${target.feedbackId}`;
}

function deriveGrantKey(secret: string) {
	return createHash("sha256")
		.update(`crew:event-upload-grant:v2:${secret}`)
		.digest();
}

function validUploadGrant(
	value: unknown,
	upload: AttachmentUploadRecord,
): value is {
	method: "POST";
	url: string;
	fields: Record<string, string>;
	expiresAt: string;
} {
	if (!isRecord(value) || value.method !== "POST") return false;
	const url = typeof value.url === "string" ? URL.parse(value.url) : null;
	const expiresAt =
		typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
	if (
		!url ||
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		!expiresAt ||
		!Number.isFinite(expiresAt.getTime()) ||
		expiresAt.getTime() !== upload.expiresAt.getTime() ||
		!isStringRecord(value.fields)
	)
		return false;

	const fields = value.fields;
	const allowed = new Set([
		"key",
		"Content-Type",
		"x-amz-checksum-algorithm",
		"x-amz-checksum-sha256",
		"bucket",
		"X-Amz-Algorithm",
		"X-Amz-Credential",
		"X-Amz-Date",
		"X-Amz-Security-Token",
		"Policy",
		"X-Amz-Signature",
	]);
	if (Object.keys(fields).some((name) => !allowed.has(name))) return false;
	if (
		fields.key !== upload.quarantineObjectKey ||
		fields["Content-Type"] !== upload.contentType ||
		fields["x-amz-checksum-algorithm"] !== "SHA256" ||
		fields["x-amz-checksum-sha256"] !== sha256Base64(upload.sha256) ||
		!fields.bucket ||
		fields["X-Amz-Algorithm"] !== "AWS4-HMAC-SHA256" ||
		!fields["X-Amz-Credential"] ||
		!/^[0-9]{8}T[0-9]{6}Z$/.test(fields["X-Amz-Date"] ?? "") ||
		!fields.Policy ||
		!/^[a-f0-9]{64}$/.test(fields["X-Amz-Signature"] ?? "")
	)
		return false;

	const policy = decodePostPolicy(fields.Policy);
	if (!policy) return false;
	const policyExpiresAt = new Date(policy.expiration);
	const expiryDifference = expiresAt.getTime() - policyExpiresAt.getTime();
	if (
		!Number.isFinite(policyExpiresAt.getTime()) ||
		expiryDifference < 0 ||
		expiryDifference > 2_000
	)
		return false;
	const expectedConditions: unknown[] = [
		["content-length-range", upload.byteCount, upload.byteCount],
		{ "Content-Type": upload.contentType },
		{ "x-amz-checksum-algorithm": "SHA256" },
		{ "x-amz-checksum-sha256": sha256Base64(upload.sha256) },
		{ bucket: fields.bucket },
		{ "X-Amz-Algorithm": fields["X-Amz-Algorithm"] },
		{ "X-Amz-Credential": fields["X-Amz-Credential"] },
		{ "X-Amz-Date": fields["X-Amz-Date"] },
		{ key: upload.quarantineObjectKey },
	];
	if (fields["X-Amz-Security-Token"])
		expectedConditions.push({
			"X-Amz-Security-Token": fields["X-Amz-Security-Token"],
		});
	return expectedConditions.every((expected) =>
		policy.conditions.some(
			(condition) => JSON.stringify(condition) === JSON.stringify(expected),
		),
	);
}

function decodePostPolicy(value: string) {
	try {
		const policy: unknown = JSON.parse(
			Buffer.from(value, "base64").toString("utf8"),
		);
		if (
			!isRecord(policy) ||
			typeof policy.expiration !== "string" ||
			!Array.isArray(policy.conditions)
		)
			return null;
		return {
			expiration: policy.expiration,
			conditions: policy.conditions,
		};
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function sha256Base64(value: string) {
	if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid SHA-256 digest");
	return Buffer.from(value, "hex").toString("base64");
}

async function verifyImage(bytes: Buffer, contentType: AttachmentContentType) {
	if (
		!matchesMagic(bytes, contentType) ||
		!hasExactContainerBoundary(bytes, contentType)
	)
		throw new ObjectVerificationError("ATTACHMENT_TYPE_MISMATCH");
	try {
		const image = sharp(bytes, {
			failOn: "error",
			limitInputPixels: MAX_IMAGE_PIXELS,
			sequentialRead: true,
		});
		const metadata = await image.metadata();
		if (!formatMatches(metadata.format, contentType))
			throw new ObjectVerificationError("ATTACHMENT_TYPE_MISMATCH");
		if (
			!metadata.width ||
			!metadata.height ||
			metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
			(metadata.pages ?? 1) !== 1
		)
			throw new ObjectVerificationError("ATTACHMENT_IMAGE_LIMIT_EXCEEDED");
		await image.stats();
	} catch (error) {
		if (error instanceof ObjectVerificationError) throw error;
		throw new ObjectVerificationError("ATTACHMENT_DECODE_FAILED");
	}
}

export async function verifyAttachmentBytes(
	bytes: Uint8Array,
	input: Pick<UploadObjectSpec, "contentType" | "byteCount" | "sha256">,
) {
	if (
		bytes.byteLength !== input.byteCount ||
		bytes.byteLength > MAX_ATTACHMENT_BYTES
	)
		throw new ObjectVerificationError("ATTACHMENT_SIZE_MISMATCH");
	if (sha256(bytes) !== input.sha256)
		throw new ObjectVerificationError("ATTACHMENT_CHECKSUM_MISMATCH");
	await verifyImage(Buffer.from(bytes), input.contentType);
}

function hasExactContainerBoundary(bytes: Buffer, type: AttachmentContentType) {
	if (type === "image/jpeg")
		return (
			bytes.length >= 4 && bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
		);
	if (type === "image/png")
		return (
			bytes.length >= 20 &&
			bytes.readUInt32BE(bytes.length - 12) === 0 &&
			bytes.subarray(bytes.length - 8, bytes.length - 4).toString("ascii") ===
				"IEND"
		);
	if (type === "image/webp")
		return bytes.length >= 12 && bytes.readUInt32LE(4) + 8 === bytes.length;
	return false;
}

function matchesMagic(bytes: Buffer, type: AttachmentContentType) {
	if (type === "image/jpeg")
		return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
	if (type === "image/png")
		return bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	if (type === "image/webp")
		return (
			bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
			bytes.subarray(8, 12).toString("ascii") === "WEBP"
		);
	return false;
}

function formatMatches(
	format: string | undefined,
	type: AttachmentContentType,
) {
	if (type === "image/jpeg") return format === "jpeg";
	if (type === "image/png") return format === "png";
	if (type === "image/webp") return format === "webp";
	return false;
}

function secondsUntil(expiresAt: Date) {
	const seconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
	if (seconds < 1 || seconds > 900) throw new Error("Invalid presign expiry");
	return seconds;
}

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

class ConcurrencyGate {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(private readonly limit: number) {
		if (!Number.isInteger(limit) || limit < 1)
			throw new Error("Invalid concurrency limit");
	}

	async run<T>(work: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit)
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		this.active++;
		try {
			return await work();
		} finally {
			this.active--;
			this.waiters.shift()?.();
		}
	}
}
