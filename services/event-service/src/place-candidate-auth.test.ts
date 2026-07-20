import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";
import {
	createPlaceCandidateServiceAuth,
	issuePlaceCandidateServiceToken,
	PLACE_CANDIDATE_READ_SCOPE,
	PLACE_CANDIDATE_WRITE_SCOPE,
} from "./place-candidate-auth";

const current = {
	id: "catalog-current",
	key: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
};
const previous = {
	id: "catalog-previous",
	key: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk",
};
const issuer = "crew-place-catalog";
const audience = "crew-event-service";

describe("place-candidate service authentication", () => {
	test("accepts current and previous credentials only for the requested scope", async () => {
		const verify = createPlaceCandidateServiceAuth({
			issuer,
			audience,
			current,
			previous,
		});
		for (const key of [current, previous]) {
			const token = await issuePlaceCandidateServiceToken({
				issuer,
				audience,
				key,
				scope: PLACE_CANDIDATE_WRITE_SCOPE,
			});
			expect(await verify(token, PLACE_CANDIDATE_WRITE_SCOPE)).toBe(true);
			expect(await verify(token, PLACE_CANDIDATE_READ_SCOPE)).toBe(false);
		}
	});

	test("generically rejects wrong JWT binding, algorithm, lifetime and KID", async () => {
		const verify = createPlaceCandidateServiceAuth({
			issuer,
			audience,
			current,
		});
		const now = Math.floor(Date.now() / 1_000);
		const cases = [
			await token({ kid: "unknown" }),
			await token({ alg: "HS384" }),
			await token({ type: "not-jwt" }),
			await token({ issuer: "wrong-issuer" }),
			await token({ audience: "wrong-audience" }),
			await token({ subject: "user" }),
			await token({ scope: PLACE_CANDIDATE_READ_SCOPE }),
			await token({ issuedAt: now - 120, expiresAt: now - 60 }),
			await token({ issuedAt: now - 301, expiresAt: now + 1 }),
			await token({ issuedAt: now, expiresAt: now + 301 }),
		];
		for (const candidate of cases) {
			expect(await verify(candidate, PLACE_CANDIDATE_WRITE_SCOPE)).toBe(false);
		}
		expect(await verify("not-a-jwt", PLACE_CANDIDATE_WRITE_SCOPE)).toBe(false);
	});

	test("rejects malformed or duplicate rotation keys during startup", () => {
		expect(() =>
			createPlaceCandidateServiceAuth({
				issuer,
				audience,
				current,
				previous: { ...previous, id: current.id },
			}),
		).toThrow("unique");
		expect(() =>
			createPlaceCandidateServiceAuth({
				issuer,
				audience,
				current: { ...current, key: "not-a-key" },
			}),
		).toThrow("32-byte");
	});
});

function token(overrides: {
	kid?: string;
	alg?: "HS256" | "HS384";
	type?: string;
	issuer?: string;
	audience?: string;
	subject?: string;
	scope?: string;
	issuedAt?: number;
	expiresAt?: number;
}) {
	const now = Math.floor(Date.now() / 1_000);
	return new SignJWT({
		scope: overrides.scope ?? PLACE_CANDIDATE_WRITE_SCOPE,
	})
		.setProtectedHeader({
			alg: overrides.alg ?? "HS256",
			kid: overrides.kid ?? current.id,
			typ: overrides.type ?? "JWT",
		})
		.setIssuer(overrides.issuer ?? issuer)
		.setAudience(overrides.audience ?? audience)
		.setSubject(overrides.subject ?? "place-catalog-client")
		.setIssuedAt(overrides.issuedAt ?? now)
		.setExpirationTime(overrides.expiresAt ?? now + 300)
		.sign(Buffer.from(current.key, "base64url"));
}
