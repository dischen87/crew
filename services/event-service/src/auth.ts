import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { Actor } from "./domain";

export type VerifyUserToken = (token: string) => Promise<Actor>;

type VerifyOptions = {
	issuer: string;
	audience: string;
};

export function createJwtVerifier(
	options: VerifyOptions & {
		jwksUrl: string;
		cacheMaxAge: number;
		cooldownDuration: number;
		timeoutDuration: number;
	},
): VerifyUserToken {
	const jwks = createRemoteJWKSet(new URL(options.jwksUrl), {
		cacheMaxAge: options.cacheMaxAge,
		cooldownDuration: options.cooldownDuration,
		timeoutDuration: options.timeoutDuration,
	});
	return createJwtVerifierWithKeySet(jwks, options);
}

export function createJwtVerifierWithKeySet(
	keySet: JWTVerifyGetKey,
	options: VerifyOptions,
): VerifyUserToken {
	return async (token) => {
		const { payload } = await jwtVerify(token, keySet, {
			algorithms: ["RS256"],
			issuer: options.issuer,
			audience: options.audience,
			requiredClaims: ["sub", "exp"],
		});
		if (
			typeof payload.sub !== "string" ||
			!/^usr_[a-f0-9]{32}$/.test(payload.sub)
		) {
			throw new Error("Invalid token subject");
		}
		if (payload.email === undefined && payload.email_verified === undefined) {
			return { id: payload.sub };
		}
		if (typeof payload.email !== "string" || payload.email_verified !== true) {
			throw new Error("Invalid verified email claims");
		}
		const email = normalizeEmail(payload.email);
		if (!isEmail(email)) throw new Error("Invalid verified email claim");
		return { id: payload.sub, email };
	};
}

function normalizeEmail(value: string) {
	return value.trim().toLowerCase();
}

function isEmail(value: string) {
	return (
		value.length >= 3 && value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value)
	);
}
