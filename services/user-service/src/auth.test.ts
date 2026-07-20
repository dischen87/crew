import { describe, expect, test } from "bun:test";
import {
	decodeProtectedHeader,
	exportPKCS8,
	exportSPKI,
	generateKeyPair,
} from "jose";
import { createTokenService, createTokenServiceFromPem } from "./auth";
import { loadConfig } from "./config";

const options = {
	issuer: "crew-user-service",
	audience: "crew-mobile",
	accessTokenTtlSeconds: 900,
};
const identity = {
	userId: "usr_00000000000000000000000000000001",
	sessionId: "ses_00000000000000000000000000000001",
	email: "member@example.com",
};

describe("RS256 access-token key rotation", () => {
	test("signs only with current and publishes/verifies current plus previous", async () => {
		const first = await generateKeyPair("RS256", {
			modulusLength: 2048,
			extractable: true,
		});
		const next = await generateKeyPair("RS256", { modulusLength: 2048 });
		const firstOnly = await createTokenService(
			first.privateKey,
			first.publicKey,
			{ ...options, keyId: "rsa-first" },
		);
		const firstToken = (await firstOnly.issueAccessToken(identity)).accessToken;
		const prepublished = await createTokenService(
			first.privateKey,
			first.publicKey,
			{
				...options,
				keyId: "rsa-first",
				previous: { keyId: "rsa-next", publicKey: next.publicKey },
			},
		);
		expect(prepublished.jwks().keys.map(({ kid }) => kid)).toEqual([
			"rsa-first",
			"rsa-next",
		]);
		expect(
			decodeProtectedHeader(
				(await prepublished.issueAccessToken(identity)).accessToken,
			).kid,
		).toBe("rsa-first");

		const rotated = await createTokenService(next.privateKey, next.publicKey, {
			...options,
			keyId: "rsa-next",
			previous: { keyId: "rsa-first", publicKey: first.publicKey },
		});
		const nextToken = (await rotated.issueAccessToken(identity)).accessToken;
		expect(decodeProtectedHeader(nextToken)).toMatchObject({
			alg: "RS256",
			kid: "rsa-next",
			typ: "JWT",
		});
		expect(await rotated.verifyAccessToken(firstToken)).toEqual(identity);
		expect(await rotated.verifyAccessToken(nextToken)).toEqual(identity);
		expect(rotated.jwks().keys.map(({ kid }) => kid)).toEqual([
			"rsa-next",
			"rsa-first",
		]);
		const serialized = JSON.stringify(rotated.jwks());
		for (const privateField of ['"d"', '"p"', '"q"', '"dp"', '"dq"', '"qi"']) {
			expect(serialized).not.toContain(privateField);
		}
		await expect(firstOnly.verifyAccessToken(nextToken)).rejects.toThrow();
	});

	test("fails startup on mismatched, duplicate, malformed or non-RSA keys", async () => {
		const first = await generateKeyPair("RS256", {
			modulusLength: 2048,
			extractable: true,
		});
		const other = await generateKeyPair("RS256", { modulusLength: 2048 });
		const ec = await generateKeyPair("ES256");
		await expect(
			createTokenService(first.privateKey, other.publicKey, {
				...options,
				keyId: "rsa-first",
			}),
		).rejects.toThrow("does not match");
		await expect(
			createTokenService(first.privateKey, first.publicKey, {
				...options,
				keyId: "rsa-first",
				previous: { keyId: "rsa-first", publicKey: other.publicKey },
			}),
		).rejects.toThrow("IDs must be unique");
		await expect(
			createTokenService(first.privateKey, first.publicKey, {
				...options,
				keyId: "rsa-first",
				previous: { keyId: "rsa-copy", publicKey: first.publicKey },
			}),
		).rejects.toThrow("distinct public material");
		await expect(
			createTokenService(first.privateKey, first.publicKey, {
				...options,
				keyId: "rsa-first",
				previous: { keyId: "ec-key", publicKey: ec.publicKey },
			}),
		).rejects.toThrow("RSA public keys");
		await expect(
			createTokenService(ec.privateKey, ec.publicKey, {
				...options,
				keyId: "ec-key",
			}),
		).rejects.toThrow("RSA public keys");
		await expect(
			createTokenServiceFromPem(
				await exportPKCS8(first.privateKey),
				await exportSPKI(first.publicKey),
				{
					...options,
					keyId: "rsa-first",
					previous: {
						keyId: "malformed",
						publicKeyPem: "not-a-public-key",
					},
				},
			),
		).rejects.toThrow();
	});

	test("requires a complete, unique optional previous-key configuration", () => {
		expect(() => loadConfig({ JWT_PREVIOUS_KEY_ID: "rsa-old" })).toThrow();
		expect(() =>
			loadConfig({ JWT_PREVIOUS_PUBLIC_KEY_PATH: "/run/keys/old.pem" }),
		).toThrow();
		expect(() =>
			loadConfig({
				JWT_KEY_ID: "same",
				JWT_PREVIOUS_KEY_ID: "same",
				JWT_PREVIOUS_PUBLIC_KEY_PATH: "/run/keys/old.pem",
			}),
		).toThrow("key IDs must be unique");
		expect(
			loadConfig({
				JWT_PREVIOUS_KEY_ID: "rsa-old",
				JWT_PREVIOUS_PUBLIC_KEY_PATH: "/run/keys/old.pem",
			}),
		).toMatchObject({
			jwtPreviousKeyId: "rsa-old",
			jwtPreviousPublicKeyPath: "/run/keys/old.pem",
		});
		expect(
			loadConfig({
				JWT_PREVIOUS_KEY_ID: "",
				JWT_PREVIOUS_PUBLIC_KEY_PATH: "",
			}).jwtPreviousKeyId,
		).toBeUndefined();
	});
});
