import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	exportJWK,
	importPKCS8,
	importSPKI,
	type JWK,
	type JWTPayload,
	jwtVerify,
	SignJWT,
} from "jose";

export type AuthenticatedUser = {
	userId: string;
	sessionId: string;
	email: string;
};

export type TokenService = {
	issueAccessToken(input: {
		userId: string;
		sessionId: string;
		email: string;
	}): Promise<{
		accessToken: string;
		expiresInSeconds: number;
	}>;
	verifyAccessToken(token: string): Promise<AuthenticatedUser>;
	jwks(): { keys: JWK[] };
};

type TokenOptions = {
	issuer: string;
	audience: string;
	keyId: string;
	accessTokenTtlSeconds: number;
	previous?: { keyId: string; publicKey: CryptoKey };
};

type PemTokenOptions = Omit<TokenOptions, "previous"> & {
	previous?: { keyId: string; publicKeyPem: string };
};

export async function createTokenServiceFromPem(
	privateKeyPem: string,
	publicKeyPem: string,
	options: PemTokenOptions,
): Promise<TokenService> {
	const { previous, ...tokenOptions } = options;
	const [privateKey, publicKey, previousPublicKey] = await Promise.all([
		importPKCS8(privateKeyPem, "RS256"),
		importSPKI(publicKeyPem, "RS256"),
		previous ? importSPKI(previous.publicKeyPem, "RS256") : undefined,
	]);
	return createTokenService(privateKey, publicKey, {
		...tokenOptions,
		...(previous && previousPublicKey
			? {
					previous: {
						keyId: previous.keyId,
						publicKey: previousPublicKey,
					},
				}
			: {}),
	});
}

export async function createTokenService(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
	options: TokenOptions,
): Promise<TokenService> {
	const current = await verificationKey(options.keyId, publicKey);
	const previous = options.previous
		? await verificationKey(options.previous.keyId, options.previous.publicKey)
		: undefined;
	if (previous?.keyId === current.keyId) {
		throw new Error("JWT verification key IDs must be unique");
	}
	if (previous?.material === current.material) {
		throw new Error("JWT verification keys must use distinct public material");
	}
	await assertCurrentKeyPair(privateKey, publicKey, options);
	const keys = new Map(
		[current, previous]
			.filter((key): key is VerificationKey => Boolean(key))
			.map((key) => [key.keyId, key.publicKey]),
	);

	return {
		async issueAccessToken({ userId, sessionId, email }) {
			if (!isNormalizedEmail(email)) {
				throw new Error("Access-token email must be normalized and verified");
			}
			const accessToken = await new SignJWT({
				sid: sessionId,
				email,
				email_verified: true,
			})
				.setProtectedHeader({ alg: "RS256", kid: options.keyId, typ: "JWT" })
				.setIssuer(options.issuer)
				.setAudience(options.audience)
				.setSubject(userId)
				.setIssuedAt()
				.setJti(randomUUID())
				.setExpirationTime(`${options.accessTokenTtlSeconds}s`)
				.sign(privateKey);

			return { accessToken, expiresInSeconds: options.accessTokenTtlSeconds };
		},

		async verifyAccessToken(token) {
			const { payload } = await jwtVerify(
				token,
				(protectedHeader) => {
					if (
						protectedHeader.alg !== "RS256" ||
						typeof protectedHeader.kid !== "string"
					) {
						throw new Error("Invalid access-token signing key");
					}
					const selected = keys.get(protectedHeader.kid);
					if (!selected) throw new Error("Invalid access-token signing key");
					return selected;
				},
				{
					algorithms: ["RS256"],
					issuer: options.issuer,
					audience: options.audience,
				},
			);
			return claimsToUser(payload);
		},

		jwks() {
			return {
				keys: [current, previous]
					.filter((key): key is VerificationKey => Boolean(key))
					.map((key) => key.jwk),
			};
		},
	};
}

type VerificationKey = {
	keyId: string;
	publicKey: CryptoKey;
	jwk: JWK;
	material: string;
};

async function verificationKey(
	keyId: string,
	publicKey: CryptoKey,
): Promise<VerificationKey> {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) {
		throw new Error("Invalid JWT verification key ID");
	}
	const exported = await exportJWK(publicKey);
	if (
		exported.kty !== "RSA" ||
		typeof exported.n !== "string" ||
		typeof exported.e !== "string"
	) {
		throw new Error("JWT verification keys must be RSA public keys");
	}
	return {
		keyId,
		publicKey,
		jwk: {
			kty: "RSA",
			n: exported.n,
			e: exported.e,
			alg: "RS256",
			kid: keyId,
			use: "sig",
		},
		material: `${exported.n}.${exported.e}`,
	};
}

async function assertCurrentKeyPair(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
	options: TokenOptions,
) {
	try {
		const probe = await new SignJWT({ purpose: "startup-key-validation" })
			.setProtectedHeader({ alg: "RS256", kid: options.keyId, typ: "JWT" })
			.setIssuer(options.issuer)
			.setAudience(options.audience)
			.setIssuedAt()
			.setExpirationTime("1m")
			.sign(privateKey);
		await jwtVerify(probe, publicKey, {
			algorithms: ["RS256"],
			issuer: options.issuer,
			audience: options.audience,
		});
	} catch {
		throw new Error("JWT current private/public key pair does not match");
	}
}

function claimsToUser(payload: JWTPayload) {
	if (
		!payload.sub ||
		typeof payload.sid !== "string" ||
		typeof payload.email !== "string" ||
		payload.email_verified !== true ||
		!isNormalizedEmail(payload.email)
	) {
		throw new Error("Invalid access-token claims");
	}
	if (
		!/^usr_[a-f0-9]{32}$/.test(payload.sub) ||
		!/^ses_[a-f0-9]{32}$/.test(payload.sid)
	) {
		throw new Error("Invalid access-token identity");
	}
	return { userId: payload.sub, sessionId: payload.sid, email: payload.email };
}

function isNormalizedEmail(value: string) {
	return (
		value.length <= 254 &&
		value === value.trim().toLowerCase() &&
		/^[^@\s]+@[^@\s]+$/.test(value)
	);
}

export function createOpaqueSecret(prefix: "ml" | "rt") {
	return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string) {
	return createHash("sha256").update(secret).digest("hex");
}

export function createRefreshToken(sessionId: string, key: string) {
	return `rt_${createHmac("sha256", key).update(sessionId).digest("base64url")}`;
}

export function createStablePrivateHash(value: string, key: string) {
	return createHmac("sha256", key)
		.update("crew-user-service-scope-v1\0")
		.update(value)
		.digest("hex");
}

export type IdempotencyCodec = {
	seal(value: unknown, associatedData: string): string;
	open(value: string, associatedData: string): unknown;
};

export type IdempotencyPayloadKey = { id: string; key: string };
export type IdempotencyPayloadKeyring = {
	current: IdempotencyPayloadKey;
	previous?: IdempotencyPayloadKey;
};

export function createIdempotencyCodec(
	keyring: IdempotencyPayloadKeyring | string,
): IdempotencyCodec {
	let current = idempotencyPayloadKey(
		typeof keyring === "string"
			? { id: "legacy-upgrade", key: keyring }
			: keyring.current,
	);
	if (typeof keyring === "string") {
		current = { ...current, id: legacyIdempotencyKeyId(current.material) };
	}
	const keys = new Map<string, Buffer>([
		[current.id, current.material],
		[legacyIdempotencyKeyId(current.material), current.material],
	]);
	if (typeof keyring !== "string" && keyring.previous) {
		const previous = idempotencyPayloadKey(keyring.previous);
		if (previous.id === current.id)
			throw new Error("Idempotency payload key IDs must be unique");
		if (previous.material.equals(current.material))
			throw new Error("Idempotency payload key material must be unique");
		for (const id of [previous.id, legacyIdempotencyKeyId(previous.material)]) {
			const existing = keys.get(id);
			if (existing && !existing.equals(previous.material))
				throw new Error("Idempotency payload key aliases must be unique");
			keys.set(id, previous.material);
		}
	}

	return {
		seal(value, associatedData) {
			const iv = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", current.material, iv);
			cipher.setAAD(Buffer.from(associatedData, "utf8"));
			const encrypted = Buffer.concat([
				cipher.update(JSON.stringify(value), "utf8"),
				cipher.final(),
			]);
			return [
				"v1",
				current.id,
				iv.toString("base64url"),
				cipher.getAuthTag().toString("base64url"),
				encrypted.toString("base64url"),
			].join(".");
		},
		open(value, associatedData) {
			const [version, actualKeyId, iv, tag, encrypted] = value.split(".");
			if (
				version !== "v1" ||
				!actualKeyId ||
				!iv ||
				!tag ||
				encrypted === undefined
			) {
				throw new Error("Invalid idempotency response payload");
			}
			const key = keys.get(actualKeyId);
			if (!key) throw new Error("Idempotency payload key is unavailable");
			const decipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(iv, "base64url"),
			);
			decipher.setAuthTag(Buffer.from(tag, "base64url"));
			decipher.setAAD(Buffer.from(associatedData, "utf8"));
			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(encrypted, "base64url")),
				decipher.final(),
			]);
			return JSON.parse(plaintext.toString("utf8"));
		},
	};
}

function idempotencyPayloadKey(key: IdempotencyPayloadKey) {
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(key.id))
		throw new Error("Invalid idempotency payload key ID");
	if (key.key.length < 32 || key.key.length > 512)
		throw new Error("Invalid idempotency payload key material");
	return {
		id: key.id,
		material: createHash("sha256")
			.update("crew-user-service-idempotency-v1\0")
			.update(key.key)
			.digest(),
	};
}

function legacyIdempotencyKeyId(key: Buffer) {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createId(
	prefix: "usr" | "ses" | "dev" | "ml" | "job" | "pjob",
) {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
