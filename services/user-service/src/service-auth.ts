import { randomUUID } from "node:crypto";
import { decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import { isDeliveryPayloadKey } from "./delivery-payload";

const EVENT_NOTIFICATION_SCOPE = "user:event-notifications:write";
const MEMBER_DIRECTORY_SCOPE = "user:member-directory:read";

export type ServiceAuthKey = { id: string; key: string };

export type EventNotificationServiceVerifier = {
	verify(token: string): Promise<boolean>;
};

export type MemberDirectoryServiceVerifier = EventNotificationServiceVerifier;

export function createEventNotificationServiceAuth(options: {
	issuer: string;
	audience: string;
	current: ServiceAuthKey;
	previous?: ServiceAuthKey;
}): EventNotificationServiceVerifier {
	return createServiceAuthVerifier(
		options,
		"event-service",
		EVENT_NOTIFICATION_SCOPE,
	);
}

export function createMemberDirectoryServiceAuth(options: {
	issuer: string;
	audience: string;
	current: ServiceAuthKey;
	previous?: ServiceAuthKey;
}): MemberDirectoryServiceVerifier {
	return createServiceAuthVerifier(
		options,
		"api-gateway",
		MEMBER_DIRECTORY_SCOPE,
	);
}

function createServiceAuthVerifier(
	options: {
		issuer: string;
		audience: string;
		current: ServiceAuthKey;
		previous?: ServiceAuthKey;
	},
	subject: string,
	scope: string,
): EventNotificationServiceVerifier {
	const keys = [options.current, options.previous]
		.filter((key): key is ServiceAuthKey => Boolean(key))
		.map(({ id, key }) => ({ id: validateKeyId(id), key: decodeKey(key) }));
	if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
		throw new Error("Service-auth key IDs must be unique");
	}
	const current = keys[0];
	if (!current) throw new Error("A current service-auth key is required");

	return {
		async verify(token) {
			try {
				const header = decodeProtectedHeader(token);
				const selected = keys.find(({ id }) => id === header.kid);
				if (!selected || header.alg !== "HS256") return false;
				const { payload } = await jwtVerify(token, selected.key, {
					algorithms: ["HS256"],
					issuer: options.issuer,
					audience: options.audience,
					clockTolerance: 5,
					maxTokenAge: "5m",
				});
				return (
					payload.sub === subject &&
					payload.scope === scope &&
					typeof payload.iat === "number" &&
					typeof payload.exp === "number" &&
					payload.exp > payload.iat &&
					payload.exp - payload.iat <= 300
				);
			} catch {
				return false;
			}
		},
	};
}

export function issueEventNotificationServiceToken(options: {
	issuer: string;
	audience: string;
	key: ServiceAuthKey;
}) {
	return issueServiceToken(options, "event-service", EVENT_NOTIFICATION_SCOPE);
}

export function issueMemberDirectoryServiceToken(options: {
	issuer: string;
	audience: string;
	key: ServiceAuthKey;
}) {
	return issueServiceToken(options, "api-gateway", MEMBER_DIRECTORY_SCOPE);
}

function issueServiceToken(
	options: { issuer: string; audience: string; key: ServiceAuthKey },
	subject: string,
	scope: string,
) {
	return new SignJWT({ scope })
		.setProtectedHeader({
			alg: "HS256",
			kid: validateKeyId(options.key.id),
			typ: "JWT",
		})
		.setIssuer(options.issuer)
		.setAudience(options.audience)
		.setSubject(subject)
		.setIssuedAt()
		.setExpirationTime("5m")
		.setJti(randomUUID())
		.sign(decodeKey(options.key.key));
}

function validateKeyId(value: string) {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
		throw new Error("Invalid service-auth key ID");
	}
	return value;
}

function decodeKey(value: string) {
	if (!isDeliveryPayloadKey(value)) {
		throw new Error("Service-auth keys must be 32-byte base64url values");
	}
	return new Uint8Array(Buffer.from(value, "base64url"));
}
