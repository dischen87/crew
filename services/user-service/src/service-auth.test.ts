import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import {
	createEventNotificationServiceAuth,
	createMemberDirectoryServiceAuth,
	issueEventNotificationServiceToken,
	issueMemberDirectoryServiceToken,
} from "./service-auth";

const currentKey = {
	id: "service-current",
	key: "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs",
};
const previousKey = {
	id: "service-previous",
	key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
};
const issuer = "crew-event-service";
const audience = "crew-user-service";

describe("event-notification service authentication", () => {
	test("accepts only current or previous target-specific HS256 credentials", async () => {
		const verifier = createEventNotificationServiceAuth({
			issuer,
			audience,
			current: currentKey,
			previous: previousKey,
		});
		for (const key of [currentKey, previousKey]) {
			const token = await issueEventNotificationServiceToken({
				issuer,
				audience,
				key,
			});
			expect(await verifier.verify(token)).toBe(true);
		}
	});

	test("generically rejects wrong kid, alg, issuer, audience, subject, scope and age", async () => {
		const verifier = createEventNotificationServiceAuth({
			issuer,
			audience,
			current: currentKey,
		});
		const now = Math.floor(Date.now() / 1_000);
		const cases = [
			await token({ kid: "unknown" }),
			await token({ alg: "HS384" }),
			await token({ issuer: "wrong-service" }),
			await token({ audience: "wrong-target" }),
			await token({ subject: "user-service" }),
			await token({ scope: "user:event-notifications:read" }),
			await token({ expiresAt: now - 60, issuedAt: now - 120 }),
			await token({ issuedAt: now - 6 * 60, expiresAt: now + 60 }),
			await token({ issuedAt: now, expiresAt: now + 301 }),
		];
		for (const candidate of cases) {
			expect(await verifier.verify(candidate)).toBe(false);
		}
		expect(await verifier.verify("not-a-jwt")).toBe(false);
	});
});

describe("member-directory service authentication", () => {
	test("rotates KIDs and binds issuer, audience, subject, scope, algorithm and age", async () => {
		const verifier = createMemberDirectoryServiceAuth({
			issuer: "crew-api-gateway",
			audience,
			current: currentKey,
			previous: previousKey,
		});
		for (const key of [currentKey, previousKey]) {
			expect(
				await verifier.verify(
					await issueMemberDirectoryServiceToken({
						issuer: "crew-api-gateway",
						audience,
						key,
					}),
				),
			).toBe(true);
		}
		const now = Math.floor(Date.now() / 1_000);
		for (const candidate of [
			await memberToken({ kid: "unknown" }),
			await memberToken({ alg: "HS384" }),
			await memberToken({ issuer: "wrong-service" }),
			await memberToken({ audience: "wrong-target" }),
			await memberToken({ subject: "event-service" }),
			await memberToken({ scope: "user:member-directory:write" }),
			await memberToken({ issuedAt: now - 360, expiresAt: now + 60 }),
			await memberToken({ issuedAt: now, expiresAt: now + 301 }),
		]) {
			expect(await verifier.verify(candidate)).toBe(false);
		}
	});
});

function token(overrides: {
	kid?: string;
	alg?: "HS256" | "HS384";
	issuer?: string;
	audience?: string;
	subject?: string;
	scope?: string;
	issuedAt?: number;
	expiresAt?: number;
}) {
	const now = Math.floor(Date.now() / 1_000);
	return new SignJWT({
		scope: overrides.scope ?? "user:event-notifications:write",
	})
		.setProtectedHeader({
			alg: overrides.alg ?? "HS256",
			kid: overrides.kid ?? currentKey.id,
			typ: "JWT",
		})
		.setIssuer(overrides.issuer ?? issuer)
		.setAudience(overrides.audience ?? audience)
		.setSubject(overrides.subject ?? "event-service")
		.setIssuedAt(overrides.issuedAt ?? now)
		.setExpirationTime(overrides.expiresAt ?? now + 300)
		.sign(Buffer.from(currentKey.key, "base64url"));
}

function memberToken(overrides: Parameters<typeof token>[0]) {
	const now = Math.floor(Date.now() / 1_000);
	return new SignJWT({ scope: overrides.scope ?? "user:member-directory:read" })
		.setProtectedHeader({
			alg: overrides.alg ?? "HS256",
			kid: overrides.kid ?? currentKey.id,
			typ: "JWT",
		})
		.setIssuer(overrides.issuer ?? "crew-api-gateway")
		.setAudience(overrides.audience ?? audience)
		.setSubject(overrides.subject ?? "api-gateway")
		.setIssuedAt(overrides.issuedAt ?? now)
		.setExpirationTime(overrides.expiresAt ?? now + 300)
		.sign(Buffer.from(currentKey.key, "base64url"));
}
