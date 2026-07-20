import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import {
	type DeliveryPayloadKey,
	DeliveryPayloadKeyUnavailableError,
	InvalidDeliveryPayloadError,
	isDeliveryPayloadKey,
} from "./delivery-payload";

export const PUSH_CATEGORIES = [
	"event_update",
	"event_reminder",
	"feed_update",
] as const;
export const PUSH_TEMPLATE_KEYS = [
	"event_updated",
	"event_starts_soon",
	"feed_entry_created",
] as const;

export type PushCategory = (typeof PUSH_CATEGORIES)[number];
export type PushTemplateKey = (typeof PUSH_TEMPLATE_KEYS)[number];
export type PushDeepLink = {
	rootEventId: string;
	eventId?: string;
	feedEntryId?: string;
};
export type PushDeliveryPayload = {
	pushToken: string;
	category: PushCategory;
	templateKey: PushTemplateKey;
	deepLink: PushDeepLink;
	locale: string;
	expiresAt: Date;
};
export type PushDeliveryMetadata = {
	jobId: string;
	eventJobId: string;
	recipientUserId: string;
	deviceId: string;
	requestId: string;
	causationRequestId: string;
	expiresAt: Date;
};
export type PushPayloadKeyring = {
	seal(metadata: PushDeliveryMetadata, payload: PushDeliveryPayload): string;
	open(
		input: PushDeliveryMetadata & {
			sealedPayload: string;
		},
	): PushDeliveryPayload;
};

export function createPushPayloadKeyring(options: {
	current: DeliveryPayloadKey;
	previous?: DeliveryPayloadKey;
}): PushPayloadKeyring {
	const keys = [options.current, options.previous]
		.filter((key): key is DeliveryPayloadKey => Boolean(key))
		.map(({ id, key }) => ({ id: validateKeyId(id), key: decodeKey(key) }));
	if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
		throw new Error("Push payload key IDs must be unique");
	}
	const current = keys[0];
	if (!current) throw new Error("A current push payload key is required");

	return {
		seal(metadata, payload) {
			validateMetadata(metadata);
			validatePayload(payload);
			if (metadata.expiresAt.getTime() !== payload.expiresAt.getTime()) {
				throw new Error("Push payload expiry mismatch");
			}
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", current.key, iv);
			cipher.setAAD(associatedData(metadata, current.id));
			const encrypted = Buffer.concat([
				cipher.update(
					JSON.stringify({
						pushToken: payload.pushToken,
						category: payload.category,
						templateKey: payload.templateKey,
						deepLink: canonicalDeepLink(payload.deepLink),
						locale: payload.locale,
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

		open({ sealedPayload, ...metadata }) {
			try {
				validateMetadata(metadata);
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
				decipher.setAAD(associatedData(metadata, keyId));
				decipher.setAuthTag(Buffer.from(tag, "base64url"));
				const parsed = JSON.parse(
					Buffer.concat([
						decipher.update(Buffer.from(encrypted, "base64url")),
						decipher.final(),
					]).toString("utf8"),
				) as Record<string, unknown>;
				if (
					Object.keys(parsed).sort().join(",") !==
						"category,deepLink,expiresAt,locale,pushToken,templateKey" ||
					typeof parsed.pushToken !== "string" ||
					typeof parsed.category !== "string" ||
					typeof parsed.templateKey !== "string" ||
					!isRecord(parsed.deepLink) ||
					typeof parsed.locale !== "string" ||
					typeof parsed.expiresAt !== "string"
				) {
					throw new InvalidDeliveryPayloadError();
				}
				const payload: PushDeliveryPayload = {
					pushToken: parsed.pushToken,
					category: parsed.category as PushCategory,
					templateKey: parsed.templateKey as PushTemplateKey,
					deepLink: parsed.deepLink as PushDeepLink,
					locale: parsed.locale,
					expiresAt: new Date(parsed.expiresAt),
				};
				validatePayload(payload);
				if (payload.expiresAt.getTime() !== metadata.expiresAt.getTime()) {
					throw new InvalidDeliveryPayloadError();
				}
				return payload;
			} catch {
				throw new InvalidDeliveryPayloadError();
			}
		},
	};
}

function validateMetadata(metadata: PushDeliveryMetadata) {
	if (
		!/^pjob_[a-f0-9]{32}$/.test(metadata.jobId) ||
		!/^job_[a-f0-9]{32}$/.test(metadata.eventJobId) ||
		!/^usr_[a-f0-9]{32}$/.test(metadata.recipientUserId) ||
		!/^dev_[a-f0-9]{32}$/.test(metadata.deviceId) ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(metadata.requestId) ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(metadata.causationRequestId) ||
		!Number.isFinite(metadata.expiresAt.getTime())
	) {
		throw new Error("Invalid push delivery metadata");
	}
}

function validatePayload(payload: PushDeliveryPayload) {
	if (
		payload.pushToken.length < 1 ||
		payload.pushToken.length > 4_096 ||
		!PUSH_CATEGORIES.includes(payload.category) ||
		!PUSH_TEMPLATE_KEYS.includes(payload.templateKey) ||
		payload.locale.length < 1 ||
		payload.locale.length > 64 ||
		!Number.isFinite(payload.expiresAt.getTime())
	) {
		throw new Error("Invalid push delivery payload");
	}
	validateDeepLink(payload.deepLink);
}

function validateDeepLink(deepLink: PushDeepLink) {
	const allowedKeys = new Set(["rootEventId", "eventId", "feedEntryId"]);
	if (
		Object.keys(deepLink).some((key) => !allowedKeys.has(key)) ||
		!/^evt_[A-Za-z0-9._:-]{1,96}$/.test(deepLink.rootEventId) ||
		(deepLink.eventId !== undefined &&
			!/^evt_[A-Za-z0-9._:-]{1,96}$/.test(deepLink.eventId)) ||
		(deepLink.feedEntryId !== undefined &&
			!/^fed_[A-Za-z0-9._:-]{1,96}$/.test(deepLink.feedEntryId))
	) {
		throw new Error("Invalid push deep link");
	}
}

function canonicalDeepLink(deepLink: PushDeepLink): PushDeepLink {
	return {
		rootEventId: deepLink.rootEventId,
		...(deepLink.eventId ? { eventId: deepLink.eventId } : {}),
		...(deepLink.feedEntryId ? { feedEntryId: deepLink.feedEntryId } : {}),
	};
}

function associatedData(metadata: PushDeliveryMetadata, keyId: string) {
	return Buffer.from(
		[
			"crew:user-service:push:v1",
			keyId,
			metadata.jobId,
			metadata.eventJobId,
			metadata.recipientUserId,
			metadata.deviceId,
			metadata.requestId,
			metadata.causationRequestId,
			metadata.expiresAt.toISOString(),
		].join("\0"),
		"utf8",
	);
}

function validateKeyId(value: string) {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
		throw new Error("Invalid push payload key ID");
	}
	return value;
}

function decodeKey(value: string) {
	if (!isDeliveryPayloadKey(value)) {
		throw new Error("Push payload keys must be 32-byte base64url values");
	}
	return Buffer.from(value, "base64url");
}

function safeEqual(left: string, right: string) {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
