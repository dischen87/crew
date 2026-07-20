import { describe, expect, test } from "bun:test";
import {
	DeliveryPayloadKeyUnavailableError,
	InvalidDeliveryPayloadError,
} from "./delivery-payload";
import {
	createPushPayloadKeyring,
	type PushDeliveryMetadata,
	type PushDeliveryPayload,
} from "./push-payload";

const oldKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const newKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const metadata: PushDeliveryMetadata = {
	jobId: "pjob_00000000000000000000000000000001",
	eventJobId: "job_00000000000000000000000000000002",
	recipientUserId: "usr_00000000000000000000000000000003",
	deviceId: "dev_00000000000000000000000000000004",
	requestId: "event.ingress.request",
	causationRequestId: "event.domain.command",
	expiresAt: new Date("2026-07-18T13:00:00.000Z"),
};
const payload: PushDeliveryPayload = {
	pushToken: "private-provider-device-token",
	category: "feed_update",
	templateKey: "feed_entry_created",
	deepLink: {
		rootEventId: "evt_root:summer.2026",
		eventId: "evt_day-1",
		feedEntryId: "fed_update_1",
	},
	locale: "de-CH",
	expiresAt: metadata.expiresAt,
};

describe("push payload keyring", () => {
	test("keeps provider and private template data sealed across key rotation", () => {
		const old = createPushPayloadKeyring({
			current: { id: "old", key: oldKey },
		});
		const sealedPayload = old.seal(metadata, payload);
		expect(sealedPayload).not.toContain(payload.pushToken);
		expect(sealedPayload).not.toContain(payload.templateKey);
		expect(sealedPayload).not.toContain(payload.deepLink.rootEventId);
		expect(sealedPayload).not.toContain(payload.locale);

		const rotated = createPushPayloadKeyring({
			current: { id: "new", key: newKey },
			previous: { id: "old", key: oldKey },
		});
		expect(rotated.open({ ...metadata, sealedPayload })).toEqual(payload);
	});

	test("authenticates every routing and correlation field as associated data", () => {
		const keyring = createPushPayloadKeyring({
			current: { id: "current", key: newKey },
		});
		const sealedPayload = keyring.seal(metadata, payload);
		for (const changed of [
			{ requestId: "changed.request" },
			{ causationRequestId: "changed.causation" },
			{ eventJobId: "job_ffffffffffffffffffffffffffffffff" },
			{ deviceId: "dev_ffffffffffffffffffffffffffffffff" },
			{ expiresAt: new Date("2026-07-18T13:01:00.000Z") },
		]) {
			expect(() =>
				keyring.open({ ...metadata, ...changed, sealedPayload }),
			).toThrow(InvalidDeliveryPayloadError);
		}
	});

	test("distinguishes rollout skew from invalid ciphertext and rejects extra links", () => {
		const old = createPushPayloadKeyring({
			current: { id: "old", key: oldKey },
		});
		const current = createPushPayloadKeyring({
			current: { id: "current", key: newKey },
		});
		const sealedPayload = old.seal(metadata, payload);
		expect(() => current.open({ ...metadata, sealedPayload })).toThrow(
			DeliveryPayloadKeyUnavailableError,
		);
		const parts = sealedPayload.split(".");
		const encrypted = parts[4];
		if (!encrypted) throw new Error("Expected encrypted payload segment");
		parts[4] = `${encrypted.startsWith("A") ? "B" : "A"}${encrypted.slice(1)}`;
		const tampered = parts.join(".");
		expect(() => old.open({ ...metadata, sealedPayload: tampered })).toThrow(
			InvalidDeliveryPayloadError,
		);
		expect(() =>
			old.seal(metadata, {
				...payload,
				deepLink: {
					...payload.deepLink,
					url: "https://attacker.example/private",
				} as typeof payload.deepLink,
			}),
		).toThrow("Invalid push deep link");
	});
});
