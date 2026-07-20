import { randomUUID } from "node:crypto";
import { decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import { isEventNotificationPayloadKey } from "./event-notification-payload";

export const PLACE_CANDIDATE_WRITE_SCOPE = "event:place-candidates:write";
export const PLACE_CANDIDATE_READ_SCOPE = "event:place-candidates:read";

export type PlaceCandidateServiceScope =
	| typeof PLACE_CANDIDATE_WRITE_SCOPE
	| typeof PLACE_CANDIDATE_READ_SCOPE;
export type PlaceCandidateServiceAuthKey = { id: string; key: string };
export type VerifyPlaceCandidateServiceToken = (
	token: string,
	requiredScope: PlaceCandidateServiceScope,
) => Promise<boolean>;

export function createPlaceCandidateServiceAuth(options: {
	issuer: string;
	audience: string;
	current: PlaceCandidateServiceAuthKey;
	previous?: PlaceCandidateServiceAuthKey;
}): VerifyPlaceCandidateServiceToken {
	const keys = [options.current, options.previous]
		.filter((key): key is PlaceCandidateServiceAuthKey => Boolean(key))
		.map(({ id, key }) => ({ id: validateKeyId(id), key: decodeKey(key) }));
	if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
		throw new Error("Place-candidate service-auth key IDs must be unique");
	}

	return async (token, requiredScope) => {
		try {
			const header = decodeProtectedHeader(token);
			const selected = keys.find(({ id }) => id === header.kid);
			if (!selected || header.alg !== "HS256" || header.typ !== "JWT") {
				return false;
			}
			const { payload } = await jwtVerify(token, selected.key, {
				algorithms: ["HS256"],
				issuer: options.issuer,
				audience: options.audience,
				clockTolerance: 5,
				maxTokenAge: "5m",
			});
			return (
				payload.sub === "place-catalog-client" &&
				payload.scope === requiredScope &&
				typeof payload.iat === "number" &&
				typeof payload.exp === "number" &&
				payload.exp > payload.iat &&
				payload.exp - payload.iat <= 300
			);
		} catch {
			return false;
		}
	};
}

export function issuePlaceCandidateServiceToken(options: {
	issuer: string;
	audience: string;
	key: PlaceCandidateServiceAuthKey;
	scope: PlaceCandidateServiceScope;
}) {
	return new SignJWT({ scope: options.scope })
		.setProtectedHeader({
			alg: "HS256",
			kid: validateKeyId(options.key.id),
			typ: "JWT",
		})
		.setIssuer(options.issuer)
		.setAudience(options.audience)
		.setSubject("place-catalog-client")
		.setIssuedAt()
		.setExpirationTime("5m")
		.setJti(randomUUID())
		.sign(decodeKey(options.key.key));
}

function validateKeyId(value: string) {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
		throw new Error("Invalid place-candidate service-auth key ID");
	}
	return value;
}

function decodeKey(value: string) {
	if (!isEventNotificationPayloadKey(value)) {
		throw new Error(
			"Place-candidate service-auth keys must be 32-byte base64url values",
		);
	}
	return new Uint8Array(Buffer.from(value, "base64url"));
}
