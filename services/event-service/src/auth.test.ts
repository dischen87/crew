import { describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createJwtVerifierWithKeySet } from "./auth";

describe("event-service user token verification", () => {
	test("verifies RS256 issuer/audience/JWKS and trusts only subject plus verified email", async () => {
		const verifiedUserId = "usr_00000000000000000000000000000001";
		const emailUserId = "usr_00000000000000000000000000000002";
		const { privateKey, publicKey } = await generateKeyPair("RS256", {
			modulusLength: 2048,
		});
		const publicJwk = await exportJWK(publicKey);
		const keySet = createLocalJWKSet({
			keys: [{ ...publicJwk, alg: "RS256", use: "sig", kid: "test-key" }],
		});
		const verify = createJwtVerifierWithKeySet(keySet, {
			issuer: "crew-user-service",
			audience: "crew-mobile",
		});
		const token = await new SignJWT({ sid: "ses_ignored", role: "owner" })
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer("crew-user-service")
			.setAudience("crew-mobile")
			.setSubject(verifiedUserId)
			.setExpirationTime("5m")
			.sign(privateKey);
		expect(await verify(token)).toEqual({ id: verifiedUserId });
		const emailToken = await new SignJWT({
			email: "Member@Example.COM ",
			email_verified: true,
			role: "owner",
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer("crew-user-service")
			.setAudience("crew-mobile")
			.setSubject(emailUserId)
			.setExpirationTime("5m")
			.sign(privateKey);
		expect(await verify(emailToken)).toEqual({
			id: emailUserId,
			email: "member@example.com",
		});

		const unverifiedEmailToken = await new SignJWT({
			email: "member@example.com",
			email_verified: false,
		})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer("crew-user-service")
			.setAudience("crew-mobile")
			.setSubject(emailUserId)
			.setExpirationTime("5m")
			.sign(privateKey);
		await expect(verify(unverifiedEmailToken)).rejects.toThrow();

		const wrongAudience = await new SignJWT({})
			.setProtectedHeader({ alg: "RS256", kid: "test-key" })
			.setIssuer("crew-user-service")
			.setAudience("other")
			.setSubject(verifiedUserId)
			.setExpirationTime("5m")
			.sign(privateKey);
		await expect(verify(wrongAudience)).rejects.toThrow();
	});
});
