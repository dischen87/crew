import { describe, expect, test } from "bun:test";
import {
	createDeliveryPayloadKeyring,
	DeliveryPayloadKeyUnavailableError,
	InvalidDeliveryPayloadError,
} from "./delivery-payload";

const oldKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const newKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const jobId = "job_0123456789abcdef0123456789abcdef";
const payload = {
	email: "person@example.com",
	token: `ml_${"a".repeat(43)}`,
	expiresAt: new Date("2026-07-18T13:00:00.000Z"),
};

describe("delivery payload keyring", () => {
	test("keeps sensitive fields sealed and reads the previous key during rotation", () => {
		const old = createDeliveryPayloadKeyring({
			current: { id: "old", key: oldKey },
		});
		const sealed = old.seal(jobId, payload);
		expect(sealed).toStartWith("v1.old.");
		expect(sealed).not.toContain(payload.email);
		expect(sealed).not.toContain(payload.token);

		const rotated = createDeliveryPayloadKeyring({
			current: { id: "new", key: newKey },
			previous: { id: "old", key: oldKey },
		});
		expect(
			rotated.open({
				jobId,
				sealedPayload: sealed,
				expiresAt: payload.expiresAt,
			}),
		).toEqual(payload);
		expect(rotated.seal(jobId, payload)).toStartWith("v1.new.");
	});

	test("authenticates job ID and expiry as associated data", () => {
		const keyring = createDeliveryPayloadKeyring({
			current: { id: "current", key: newKey },
			previous: { id: "previous", key: newKey },
		});
		const sealedPayload = keyring.seal(jobId, payload);
		expect(() =>
			keyring.open({
				jobId: "job_abcdef0123456789abcdef0123456789",
				sealedPayload,
				expiresAt: payload.expiresAt,
			}),
		).toThrow();
		expect(() =>
			keyring.open({
				jobId,
				sealedPayload: sealedPayload.replace("v1.current.", "v1.previous."),
				expiresAt: payload.expiresAt,
			}),
		).toThrow();
		expect(() =>
			keyring.open({
				jobId,
				sealedPayload,
				expiresAt: new Date(payload.expiresAt.getTime() + 1),
			}),
		).toThrow();
	});

	test("distinguishes rollout key skew from invalid ciphertext", () => {
		const next = createDeliveryPayloadKeyring({
			current: { id: "next", key: newKey },
		});
		const current = createDeliveryPayloadKeyring({
			current: { id: "current", key: oldKey },
		});
		const sealedPayload = next.seal(jobId, payload);
		const tamperedParts = sealedPayload.split(".");
		const tag = tamperedParts[3];
		if (!tag) throw new Error("Expected authentication tag");
		tamperedParts[3] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;
		expect(() =>
			current.open({ jobId, sealedPayload, expiresAt: payload.expiresAt }),
		).toThrow(DeliveryPayloadKeyUnavailableError);
		expect(() =>
			next.open({
				jobId,
				sealedPayload: tamperedParts.join("."),
				expiresAt: payload.expiresAt,
			}),
		).toThrow(InvalidDeliveryPayloadError);
	});
});
