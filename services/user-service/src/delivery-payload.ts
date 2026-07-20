import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

export type MagicLinkDeliveryPayload = {
	email: string;
	token: string;
	expiresAt: Date;
};

export type DeliveryPayloadKey = {
	id: string;
	key: string;
};

export type DeliveryPayloadKeyring = {
	seal(jobId: string, payload: MagicLinkDeliveryPayload): string;
	open(input: {
		jobId: string;
		sealedPayload: string;
		expiresAt: Date;
	}): MagicLinkDeliveryPayload;
};

export class DeliveryPayloadKeyUnavailableError extends Error {
	constructor() {
		super("Delivery payload key is unavailable");
	}
}

export class InvalidDeliveryPayloadError extends Error {
	constructor() {
		super("Invalid delivery payload");
	}
}

export function createDeliveryPayloadKeyring(options: {
	current: DeliveryPayloadKey;
	previous?: DeliveryPayloadKey;
}): DeliveryPayloadKeyring {
	const keys = [options.current, options.previous]
		.filter((key): key is DeliveryPayloadKey => Boolean(key))
		.map(({ id, key }) => ({ id: validateKeyId(id), key: decodeKey(key) }));
	if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
		throw new Error("Delivery payload key IDs must be unique");
	}
	const current = keys[0];
	if (!current) throw new Error("A current delivery payload key is required");

	return {
		seal(jobId, payload) {
			validateJob(jobId, payload.expiresAt);
			validatePayload(payload);
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", current.key, iv);
			cipher.setAAD(associatedData(jobId, payload.expiresAt, current.id));
			const encrypted = Buffer.concat([
				cipher.update(
					JSON.stringify({
						email: payload.email,
						token: payload.token,
						expiresAt: payload.expiresAt.toISOString(),
					}),
					"utf8",
				),
				cipher.final(),
			]);
			return [
				"v1",
				current.id,
				iv.toString("base64url"),
				cipher.getAuthTag().toString("base64url"),
				encrypted.toString("base64url"),
			].join(".");
		},

		open({ jobId, sealedPayload, expiresAt }) {
			try {
				validateJob(jobId, expiresAt);
			} catch {
				throw new InvalidDeliveryPayloadError();
			}
			const [version, keyId, iv, tag, encrypted, extra] =
				sealedPayload.split(".");
			if (
				version !== "v1" ||
				!keyId ||
				!iv ||
				!tag ||
				!encrypted ||
				extra !== undefined
			) {
				throw new InvalidDeliveryPayloadError();
			}
			const selected = keys.find(({ id }) => safeEqual(id, keyId));
			if (!selected) throw new DeliveryPayloadKeyUnavailableError();
			try {
				const decipher = createDecipheriv(
					"aes-256-gcm",
					selected.key,
					Buffer.from(iv, "base64url"),
				);
				decipher.setAAD(associatedData(jobId, expiresAt, keyId));
				decipher.setAuthTag(Buffer.from(tag, "base64url"));
				const plaintext = Buffer.concat([
					decipher.update(Buffer.from(encrypted, "base64url")),
					decipher.final(),
				]).toString("utf8");
				const parsed = JSON.parse(plaintext) as Record<string, unknown>;
				if (
					Object.keys(parsed).sort().join(",") !== "email,expiresAt,token" ||
					typeof parsed.email !== "string" ||
					typeof parsed.token !== "string" ||
					typeof parsed.expiresAt !== "string"
				) {
					throw new InvalidDeliveryPayloadError();
				}
				const payload = {
					email: parsed.email,
					token: parsed.token,
					expiresAt: new Date(parsed.expiresAt),
				};
				validatePayload(payload);
				if (payload.expiresAt.getTime() !== expiresAt.getTime()) {
					throw new InvalidDeliveryPayloadError();
				}
				return payload;
			} catch {
				throw new InvalidDeliveryPayloadError();
			}
		},
	};
}

export function isDeliveryPayloadKey(value: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
	return Buffer.from(value, "base64url").length === 32;
}

function decodeKey(value: string) {
	if (!isDeliveryPayloadKey(value)) {
		throw new Error("Delivery payload keys must be 32-byte base64url values");
	}
	return Buffer.from(value, "base64url");
}

function validateKeyId(value: string) {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
		throw new Error("Invalid delivery payload key ID");
	}
	return value;
}

function validateJob(jobId: string, expiresAt: Date) {
	if (
		!/^job_[a-f0-9]{32}$/.test(jobId) ||
		!Number.isFinite(expiresAt.getTime())
	) {
		throw new Error("Invalid delivery job metadata");
	}
}

function validatePayload(payload: MagicLinkDeliveryPayload) {
	if (
		payload.email.length > 254 ||
		payload.email !== payload.email.trim().toLowerCase() ||
		!/^[^@\s]+@[^@\s]+$/.test(payload.email) ||
		!/^ml_[A-Za-z0-9_-]{43}$/.test(payload.token) ||
		!Number.isFinite(payload.expiresAt.getTime())
	) {
		throw new Error("Invalid magic-link delivery payload");
	}
}

function associatedData(jobId: string, expiresAt: Date, keyId: string) {
	return Buffer.from(
		`crew:user-service:delivery:magic-link:v1\0${keyId}\0${jobId}\0${expiresAt.toISOString()}`,
		"utf8",
	);
}

function safeEqual(left: string, right: string) {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}
