import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

const JOB_ID = /^job_[a-f0-9]{32}$/;
const USER_ID = /^usr_[a-f0-9]{32}$/;
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const FEED_ID = /^fed_[A-Za-z0-9._:-]{1,96}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type EventNotificationPayload = {
	recipientUserId: string;
	category: "feed_update";
	templateKey: "feed_entry_created";
	deepLink: {
		rootEventId: string;
		eventId?: string;
		feedEntryId: string;
	};
	expiresAt: string;
	requestId: string;
	causationRequestId: string;
};

export type EventNotificationPayloadKey = { kid: string; key: string };

export class EventNotificationPayloadKeyUnavailableError extends Error {
	constructor() {
		super("Event notification payload key is unavailable");
	}
}

export class InvalidEventNotificationPayloadError extends Error {
	constructor() {
		super("Invalid event notification payload");
	}
}

export class EventNotificationPayloadCodec {
	private readonly current: { kid: string; key: Buffer };
	private readonly keys = new Map<string, Buffer>();

	constructor(
		current: EventNotificationPayloadKey,
		previous?: EventNotificationPayloadKey,
	) {
		this.current = decodePayloadKey(current);
		this.keys.set(this.current.kid, this.current.key);
		if (previous) {
			const decoded = decodePayloadKey(previous);
			if (decoded.kid === this.current.kid)
				throw new Error("Event notification payload key IDs must be unique");
			this.keys.set(decoded.kid, decoded.key);
		}
	}

	seal(jobId: string, payload: EventNotificationPayload) {
		validateJobId(jobId);
		validatePayload(payload);
		if (payload.requestId !== jobId)
			throw new InvalidEventNotificationPayloadError();
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", this.current.key, iv);
		cipher.setAAD(associatedData(jobId, this.current.kid, payload.expiresAt));
		const encrypted = Buffer.concat([
			cipher.update(JSON.stringify(payload), "utf8"),
			cipher.final(),
		]);
		return {
			kid: this.current.kid,
			ciphertext: [iv, cipher.getAuthTag(), encrypted]
				.map((part) => part.toString("base64url"))
				.join("."),
		};
	}

	open(jobId: string, kid: string, ciphertext: string, expiresAt: string) {
		validateJobId(jobId);
		const canonicalExpiresAt = canonicalDate(expiresAt);
		if (!KEY_ID.test(kid)) throw new InvalidEventNotificationPayloadError();
		const key = this.keys.get(kid);
		if (!key) throw new EventNotificationPayloadKeyUnavailableError();
		try {
			const parts = ciphertext.split(".");
			if (parts.length !== 3) throw new Error("Invalid envelope");
			const [ivValue, tagValue, encryptedValue] = parts;
			if (!ivValue || !tagValue || !encryptedValue)
				throw new Error("Invalid envelope");
			const iv = Buffer.from(ivValue, "base64url");
			const tag = Buffer.from(tagValue, "base64url");
			const encrypted = Buffer.from(encryptedValue, "base64url");
			if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0)
				throw new Error("Invalid envelope");
			const decipher = createDecipheriv("aes-256-gcm", key, iv);
			decipher.setAAD(associatedData(jobId, kid, canonicalExpiresAt));
			decipher.setAuthTag(tag);
			const value: unknown = JSON.parse(
				Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
					"utf8",
				),
			);
			validatePayload(value);
			if (value.requestId !== jobId || value.expiresAt !== canonicalExpiresAt)
				throw new InvalidEventNotificationPayloadError();
			return value;
		} catch (error) {
			if (error instanceof EventNotificationPayloadKeyUnavailableError)
				throw error;
			throw new InvalidEventNotificationPayloadError();
		}
	}
}

export function eventNotificationJobId() {
	return `job_${randomBytes(16).toString("hex")}`;
}

export function isEventNotificationPayloadKey(value: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
	try {
		const bytes = Buffer.from(value, "base64url");
		const canonical = bytes.toString("base64url");
		return (
			bytes.length === 32 &&
			canonical.length === value.length &&
			timingSafeEqual(Buffer.from(canonical), Buffer.from(value))
		);
	} catch {
		return false;
	}
}

function validatePayload(
	value: unknown,
): asserts value is EventNotificationPayload {
	if (!isRecord(value)) throw new InvalidEventNotificationPayloadError();
	if (
		!hasOnlyKeys(value, [
			"recipientUserId",
			"category",
			"templateKey",
			"deepLink",
			"expiresAt",
			"requestId",
			"causationRequestId",
		])
	)
		throw new InvalidEventNotificationPayloadError();
	const deepLink = value.deepLink;
	if (
		!USER_ID.test(String(value.recipientUserId)) ||
		value.category !== "feed_update" ||
		value.templateKey !== "feed_entry_created" ||
		!isRecord(deepLink) ||
		!hasOnlyKeys(deepLink, ["rootEventId", "eventId", "feedEntryId"]) ||
		!EVENT_ID.test(String(deepLink.rootEventId)) ||
		(deepLink.eventId !== undefined &&
			!EVENT_ID.test(String(deepLink.eventId))) ||
		!FEED_ID.test(String(deepLink.feedEntryId)) ||
		typeof value.expiresAt !== "string" ||
		canonicalDate(value.expiresAt) !== value.expiresAt ||
		!REQUEST_ID.test(String(value.requestId)) ||
		!REQUEST_ID.test(String(value.causationRequestId))
	)
		throw new InvalidEventNotificationPayloadError();
}

function decodePayloadKey(value: EventNotificationPayloadKey) {
	if (!KEY_ID.test(value.kid))
		throw new Error("Invalid event notification payload key ID");
	if (!isEventNotificationPayloadKey(value.key))
		throw new Error(
			"Event notification payload keys must be 32-byte base64url values",
		);
	return { kid: value.kid, key: Buffer.from(value.key, "base64url") };
}

function associatedData(jobId: string, kid: string, expiresAt: string) {
	return Buffer.from(
		["crew:event-service:notification:v1", kid, jobId, expiresAt].join("\0"),
		"utf8",
	);
}

function canonicalDate(value: string) {
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds))
		throw new InvalidEventNotificationPayloadError();
	return new Date(milliseconds).toISOString();
}

function validateJobId(value: string) {
	if (!JOB_ID.test(value)) throw new InvalidEventNotificationPayloadError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
	return Object.keys(value).every((key) => allowed.includes(key));
}
