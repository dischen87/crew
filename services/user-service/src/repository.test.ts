import { describe, expect, test } from "bun:test";
import { createId, createIdempotencyCodec, hashSecret } from "./auth";
import { InMemoryUserRepository } from "./repository";

describe("InMemoryUserRepository transaction seam", () => {
	test("rolls domain state back when an idempotent operation throws", async () => {
		const repository = new InMemoryUserRepository();
		const now = new Date("2026-07-18T12:00:00.000Z");
		const tokenHash = hashSecret("rolled-back-magic-link");
		const input = {
			scope: "test:rollback",
			operationId: "identityRollbackTest",
			key: "rollback-key-0001",
			fingerprint: hashSecret("rollback-fingerprint"),
			now,
			expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
		};

		await expect(
			repository.executeIdempotent(input, async (transaction) => {
				await transaction.createMagicLink({
					id: createId("ml"),
					email: "rollback@example.com",
					tokenHash,
					expiresAt: new Date(now.getTime() + 60_000),
				});
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");
		expect(
			await repository.redeemMagicLink({
				tokenHash,
				now,
				newUserId: createId("usr"),
				newSessionId: createId("ses"),
				refreshTokenHash: hashSecret("unused-refresh"),
				sessionExpiresAt: new Date(now.getTime() + 60_000),
			}),
		).toBeNull();
		expect(
			(
				await repository.executeIdempotent(input, async () => ({
					status: 200,
					body: "sealed",
					headers: {},
				}))
			).kind,
		).toBe("executed");
	});

	test("binds sealed responses to their idempotency row", () => {
		const codec = createIdempotencyCodec({
			current: {
				id: "test-idempotency-v1",
				key: "test-idempotency-codec-key-at-least-32-bytes",
			},
		});
		const payload = codec.seal({ accepted: true }, "scope\0operation\0key\0fp");
		expect(codec.open(payload, "scope\0operation\0key\0fp")).toEqual({
			accepted: true,
		});
		expect(() =>
			codec.open(payload, "different\0operation\0key\0fp"),
		).toThrow();
	});

	test("opens legacy and previous idempotency payloads during rotation", () => {
		const oldMaterial = "old-idempotency-payload-key-at-least-32-bytes";
		const newMaterial = "new-idempotency-payload-key-at-least-32-bytes";
		const associatedData = "scope\0operation\0key\0fingerprint";
		const legacy = createIdempotencyCodec(oldMaterial);
		const oldPayload = legacy.seal({ refreshToken: "private" }, associatedData);
		const rotated = createIdempotencyCodec({
			current: { id: "idempotency-v2", key: newMaterial },
			previous: { id: "idempotency-v1", key: oldMaterial },
		});

		expect(rotated.open(oldPayload, associatedData)).toEqual({
			refreshToken: "private",
		});
		expect(rotated.seal({ accepted: true }, associatedData)).toStartWith(
			"v1.idempotency-v2.",
		);
		expect(() =>
			createIdempotencyCodec({
				current: { id: "same", key: oldMaterial },
				previous: { id: "same", key: newMaterial },
			}),
		).toThrow("IDs must be unique");
		expect(() =>
			createIdempotencyCodec({
				current: { id: "current", key: oldMaterial },
				previous: { id: "previous", key: oldMaterial },
			}),
		).toThrow("material must be unique");
	});
});
