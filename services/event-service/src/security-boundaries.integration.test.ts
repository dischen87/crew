import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decodeProtectedHeader, generateKeyPair, SignJWT } from "jose";
import postgres, { type Sql } from "postgres";
import { createApp as createGatewayApp } from "../../api-gateway/src/app";
import { loadConfig as loadGatewayConfig } from "../../api-gateway/src/config";
import { MemoryRateLimiter } from "../../api-gateway/src/security";
import { migrate as migrateUser } from "../../user-service/scripts/migrate";
import { createApp as createUserApp } from "../../user-service/src/app";
import {
	createId,
	createOpaqueSecret,
	createTokenService,
	hashSecret,
	type TokenService,
} from "../../user-service/src/auth";
import { createDeliveryPayloadKeyring } from "../../user-service/src/delivery-payload";
import { PostgresUserRepository } from "../../user-service/src/postgres-repository";
import { createPushPayloadKeyring } from "../../user-service/src/push-payload";
import { MemoryAuthRateLimiter } from "../../user-service/src/rate-limit";
import { createEventNotificationServiceAuth } from "../../user-service/src/service-auth";
import { migrate as migrateEvent } from "../scripts/migrate";
import { createApp as createEventApp } from "./app";
import { createJwtVerifier as createEventJwtVerifier } from "./auth";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";

const userDatabaseUrl = Bun.env.SECURITY_USER_DATABASE_URL;
const eventDatabaseUrl = Bun.env.SECURITY_EVENT_DATABASE_URL;
const issuer = "crew-security-user-service";
const audience = "crew-security-mobile";
const keyId = "security-rsa-1";
const deliveryKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const pushKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const serviceKey = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";

type Session = {
	accessToken: string;
	refreshToken: string;
	user: { id: string; email: string };
};

type Persona =
	| "ownerA"
	| "ownerB"
	| "organizer"
	| "member"
	| "rejected"
	| "racerA"
	| "racerB";

if (!userDatabaseUrl || !eventDatabaseUrl) {
	test.skip("cross-service security boundaries (set SECURITY_USER_DATABASE_URL and SECURITY_EVENT_DATABASE_URL)", () => {});
} else {
	describe("cross-service tenant and authorization security", () => {
		let userSql: Sql;
		let eventSql: Sql;
		let userRepository: PostgresUserRepository;
		let tokens: TokenService;
		let privateKey: CryptoKey;
		let ecPrivateKey: CryptoKey;
		let userServer: ReturnType<typeof Bun.serve>;
		let eventServer: ReturnType<typeof Bun.serve>;
		let gateway: ReturnType<typeof createGatewayApp>;
		let gatewayConfig: ReturnType<typeof loadGatewayConfig>;
		let userDependencies: Parameters<typeof createUserApp>[0];
		let sensitiveInviteToken = "cin_not_created";
		const sessions = {} as Record<Persona, Session>;

		beforeAll(async () => {
			userSql = postgres(userDatabaseUrl, { max: 8 });
			eventSql = postgres(eventDatabaseUrl, { max: 12 });
			await migrateUser(userSql);
			await migrateEvent(eventSql);
			await userSql`
				TRUNCATE user_idempotency_records, user_delivery_outbox,
					user_push_outbox, users CASCADE
			`;
			await eventSql`TRUNCATE event_idempotency_records, event_roots CASCADE`;

			const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
			privateKey = rsa.privateKey;
			ecPrivateKey = (await generateKeyPair("ES256")).privateKey;
			tokens = await createTokenService(rsa.privateKey, rsa.publicKey, {
				issuer,
				audience,
				keyId,
				accessTokenTtlSeconds: 600,
			});
			userRepository = new PostgresUserRepository(userSql);
			userDependencies = {
				repository: userRepository,
				tokens,
				deliveryPayloads: createDeliveryPayloadKeyring({
					current: { id: "security-delivery", key: deliveryKey },
				}),
				pushPayloads: createPushPayloadKeyring({
					current: { id: "security-push", key: pushKey },
				}),
				eventNotificationServiceVerifier: createEventNotificationServiceAuth({
					issuer: "crew-event-service",
					audience: "crew-user-service",
					current: { id: "security-service", key: serviceKey },
				}),
				authRateLimiter: new MemoryAuthRateLimiter(
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					1_000,
				),
				clientKey: () => "198.51.100.40",
				magicLinkTtlSeconds: 600,
				refreshTokenTtlSeconds: 3_600,
				refreshTokenKey:
					"security-refresh-token-key-with-at-least-32-characters",
				idempotencyPayloadKeys: {
					current: {
						id: "security-idempotency-v1",
						key: "security-idempotency-key-with-at-least-32-characters",
					},
				},
			};
			const userApp = createUserApp(userDependencies);
			userServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => userApp.fetch(request),
			});
			const userUrl = `http://127.0.0.1:${userServer.port}`;
			const jwksUrl = `${userUrl}/.well-known/jwks.json`;

			const eventService = new EventService(
				new PostgresEventRepository(
					eventSql,
					new EventNotificationPayloadCodec({
						kid: "security-notification",
						key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
					}),
				),
				"security-invitation-key-with-at-least-32-characters",
			);
			const eventApp = createEventApp({
				service: eventService,
				verifyUserToken: createEventJwtVerifier({
					jwksUrl,
					issuer,
					audience,
					cacheMaxAge: 60_000,
					cooldownDuration: 1_000,
					timeoutDuration: 2_000,
				}),
			});
			eventServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => eventApp.fetch(request),
			});
			gatewayConfig = loadGatewayConfig({
				USER_SERVICE_URL: userUrl,
				EVENT_SERVICE_URL: `http://127.0.0.1:${eventServer.port}`,
				USER_SERVICE_JWKS_URL: jwksUrl,
				USER_TOKEN_ISSUER: issuer,
				USER_TOKEN_AUDIENCE: audience,
				JWKS_CACHE_MS: "60000",
				JWKS_COOLDOWN_MS: "1000",
				JWKS_TIMEOUT_MS: "2000",
				DOWNSTREAM_TIMEOUT_MS: "5000",
				RATE_LIMIT_MAX: "1000",
				RATE_LIMIT_MAX_ENTRIES: "1000",
			});
			gateway = createGatewayApp({
				config: gatewayConfig,
				clientIp: () => "198.51.100.40",
				rateLimiter: new MemoryRateLimiter(1_000, 60_000, 1_000),
			});

			for (const persona of [
				"ownerA",
				"ownerB",
				"organizer",
				"member",
				"rejected",
				"racerA",
				"racerB",
			] as const) {
				sessions[persona] = await signIn(persona);
			}
		});

		afterAll(async () => {
			userServer?.stop(true);
			eventServer?.stop(true);
			await userSql?.end();
			await eventSql?.end();
		});

		test("conceals tenants and revokes role, membership and invitation authority", async () => {
			const rootA = "evt_security_tenant_a";
			const rootB = "evt_security_tenant_b";
			const sharedKey = "security-root-shared-001";
			const rootAResponse = await command(
				sessions.ownerA,
				"/core/v1/event-roots",
				sharedKey,
				rootBody(rootA, "Tenant A"),
			);
			const rootBResponse = await command(
				sessions.ownerB,
				"/core/v1/event-roots",
				sharedKey,
				rootBody(rootB, "Tenant B"),
			);
			expect([rootAResponse.status, rootBResponse.status]).toEqual([201, 201]);
			const changedReplay = await command(
				sessions.ownerA,
				"/core/v1/event-roots",
				sharedKey,
				rootBody(rootA, "Injected title"),
			);
			expect(changedReplay.status).toBe(409);
			expect(await errorCode(changedReplay)).toBe("IDEMPOTENCY_KEY_REUSED");

			const organizerExpiresAt = new Date(Date.now() + 60_000).toISOString();
			const organizerInvite = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_org",
				"organizer",
				1,
				"security-invite-org-001",
				undefined,
				organizerExpiresAt,
			);
			sensitiveInviteToken = organizerInvite.token;
			const organizerReplay = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_org",
				"organizer",
				1,
				"security-invite-org-001",
				undefined,
				organizerExpiresAt,
			);
			expect(organizerReplay).toEqual(organizerInvite);
			const memberInvite = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_member",
				"participant",
				1,
				"security-invite-member-001",
			);
			expect(
				(
					await redeem(
						sessions.organizer,
						organizerInvite.token,
						"security-redeem-org-001",
					)
				).status,
			).toBe(200);
			expect(
				(
					await redeem(
						sessions.organizer,
						organizerInvite.token,
						"security-redeem-org-repeat",
					)
				).status,
			).toBe(200);
			expect(
				(
					await redeem(
						sessions.member,
						memberInvite.token,
						"security-redeem-member-001",
					)
				).status,
			).toBe(200);
			const [replayProof] = await eventSql<
				{ uses: number; redemptions: number }[]
			>`
				SELECT invitation.use_count AS uses,
					(SELECT count(*)::int FROM event_invitation_redemptions
					 WHERE invitation_id = invitation.id) AS redemptions
				FROM event_invitations invitation WHERE id = 'inv_security_org'
			`;
			expect(replayProof).toEqual({ uses: 1, redemptions: 1 });

			for (const response of [
				await read(sessions.ownerA, `/core/v1/event-roots/${rootB}`),
				await read(sessions.rejected, `/core/v1/event-roots/${rootA}`),
				await command(
					sessions.ownerA,
					`/core/v1/event-roots/${rootB}/memberships/${sessions.ownerB.user.id}`,
					"security-cross-tenant-patch",
					{
						baseVersion: 1,
						role: "participant",
						status: "active",
						reason: null,
					},
					"PATCH",
				),
				await createInviteResponse(
					sessions.rejected,
					rootA,
					"inv_cross_tenant_attack",
					"viewer",
					1,
					"security-cross-tenant-invite",
				),
			]) {
				expect(response.status).toBe(404);
				expect(await errorCode(response)).toBe("NOT_FOUND");
			}
			const spoofedMe = await gateway.request("/core/v1/me", {
				headers: {
					Authorization: `Bearer ${sessions.ownerA.accessToken}`,
					"X-User-ID": sessions.ownerB.user.id,
					"X-Actor-ID": sessions.ownerB.user.id,
				},
			});
			expect(spoofedMe.status).toBe(200);
			expect((await spoofedMe.json()).id).toBe(sessions.ownerA.user.id);

			const participantEscalation = await updateMembership(
				sessions.member,
				rootA,
				sessions.member.user.id,
				1,
				"organizer",
				"active",
				"security-self-escalation",
			);
			expect(participantEscalation.status).toBe(403);
			const organizerEscalation = await updateMembership(
				sessions.organizer,
				rootA,
				sessions.member.user.id,
				1,
				"organizer",
				"active",
				"security-organizer-escalation",
			);
			expect(organizerEscalation.status).toBe(403);
			const downgrade = await updateMembership(
				sessions.ownerA,
				rootA,
				sessions.organizer.user.id,
				1,
				"participant",
				"active",
				"security-owner-downgrade",
			);
			expect(downgrade.status).toBe(200);
			const downgradedWrite = await createInviteResponse(
				sessions.organizer,
				rootA,
				"inv_downgraded_attack",
				"viewer",
				1,
				"security-downgraded-write",
			);
			expect(downgradedWrite.status).toBe(403);

			const removed = await updateMembership(
				sessions.ownerA,
				rootA,
				sessions.member.user.id,
				1,
				"participant",
				"removed",
				"security-remove-member",
			);
			expect(removed.status).toBe(200);
			for (const response of [
				await read(sessions.member, `/core/v1/event-roots/${rootA}`),
				await createInviteResponse(
					sessions.member,
					rootA,
					"inv_removed_attack",
					"viewer",
					1,
					"security-removed-write",
				),
			]) {
				expect(response.status).toBe(404);
			}

			const rejectedInvite = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_email",
				"participant",
				1,
				"security-email-invite",
				sessions.ownerA.user.email,
			);
			const rejected = await redeem(
				sessions.rejected,
				rejectedInvite.token,
				"security-email-rejected",
			);
			expect(rejected.status).toBe(403);
			expect(await errorCode(rejected)).toBe("INVITATION_EMAIL_MISMATCH");
			const [rejectedProof] = await eventSql<
				{ uses: number; memberships: number }[]
			>`
				SELECT invitation.use_count AS uses,
					(SELECT count(*)::int FROM event_memberships
					 WHERE root_event_id = ${rootA}
						AND user_id = ${sessions.rejected.user.id}) AS memberships
				FROM event_invitations invitation WHERE id = 'inv_security_email'
			`;
			expect(rejectedProof).toEqual({ uses: 0, memberships: 0 });

			const expiredInvite = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_expired",
				"viewer",
				1,
				"security-expired-invite",
			);
			await eventSql`
				UPDATE event_invitations SET expires_at = now() - interval '1 second'
				WHERE id = 'inv_security_expired'
			`;
			const expired = await redeem(
				sessions.rejected,
				expiredInvite.token,
				"security-expired-redeem",
			);
			expect(expired.status).toBe(409);
			expect(await errorCode(expired)).toBe("INVITATION_UNAVAILABLE");

			const raceInvite = await createInvite(
				sessions.ownerA,
				rootA,
				"inv_security_race",
				"participant",
				1,
				"security-race-invite",
			);
			const race = await Promise.all([
				redeem(sessions.racerA, raceInvite.token, "security-race-a"),
				redeem(sessions.racerB, raceInvite.token, "security-race-b"),
			]);
			expect(race.map(({ status }) => status).sort()).toEqual([200, 409]);
			const [raceProof] = await eventSql<
				{ uses: number; redemptions: number }[]
			>`
				SELECT invitation.use_count AS uses,
					(SELECT count(*)::int FROM event_invitation_redemptions
					 WHERE invitation_id = invitation.id) AS redemptions
				FROM event_invitations invitation WHERE id = 'inv_security_race'
			`;
			expect(raceProof).toEqual({ uses: 1, redemptions: 1 });

			const ownerSelfChange = await updateMembership(
				sessions.ownerA,
				rootA,
				sessions.ownerA.user.id,
				1,
				"organizer",
				"active",
				"security-owner-self-change",
			);
			expect(ownerSelfChange.status).toBe(409);
			expect(await errorCode(ownerSelfChange)).toBe("OWNER_TRANSFER_REQUIRED");
			const nonOwnerTransfer = await command(
				sessions.organizer,
				`/core/v1/event-roots/${rootA}/ownership/transfer`,
				"security-non-owner-transfer",
				{
					userId: sessions.organizer.user.id,
					ownerBaseVersion: 1,
					targetBaseVersion: 2,
				},
			);
			expect(nonOwnerTransfer.status).toBe(403);
			const transfer = await command(
				sessions.ownerA,
				`/core/v1/event-roots/${rootA}/ownership/transfer`,
				"security-owner-transfer",
				{
					userId: sessions.organizer.user.id,
					ownerBaseVersion: 1,
					targetBaseVersion: 2,
				},
			);
			expect(transfer.status).toBe(200);
			const oldOwnerTransfer = await command(
				sessions.ownerA,
				`/core/v1/event-roots/${rootA}/ownership/transfer`,
				"security-former-owner-transfer",
				{
					userId: sessions.ownerA.user.id,
					ownerBaseVersion: 2,
					targetBaseVersion: 2,
				},
			);
			expect(oldOwnerTransfer.status).toBe(403);
			const [ownerProof] = await eventSql<
				{ owners: number; ownerId: string }[]
			>`
				SELECT count(*) FILTER (
					WHERE role = 'owner' AND status = 'active'
				)::int AS owners,
				max(user_id) FILTER (
					WHERE role = 'owner' AND status = 'active'
				) AS "ownerId"
				FROM event_memberships WHERE root_event_id = ${rootA}
			`;
			expect(ownerProof).toEqual({
				owners: 1,
				ownerId: sessions.organizer.user.id,
			});
		});

		test("pins JWT/JWKS and rejects session, service-auth and rate abuse", async () => {
			const jwks = await (
				await fetch(`http://127.0.0.1:${userServer.port}/.well-known/jwks.json`)
			).json();
			expect(jwks.keys).toHaveLength(1);
			expect(jwks.keys[0]).toMatchObject({
				alg: "RS256",
				kid: keyId,
				kty: "RSA",
				use: "sig",
			});
			for (const privateField of ["d", "p", "q", "dp", "dq", "qi"]) {
				expect(jwks.keys[0][privateField]).toBeUndefined();
			}

			const now = Math.floor(Date.now() / 1_000);
			const invalidTokens = [
				await attackToken({ keyId: "unknown-rsa-key" }),
				await attackToken({ expiresAt: now - 1 }),
				await attackToken({ issuer: "attacker" }),
				await attackToken({ audience: "other-client" }),
				await attackToken({ algorithm: "ES256", keyId: "attacker-ec" }),
				await attackToken({ subject: "usr_not-canonical" }),
			];
			for (const token of invalidTokens) {
				const response = await gateway.request("/core/v1/session", {
					headers: { Authorization: `Bearer ${token}` },
				});
				expect(response.status).toBe(401);
				expect(await errorCode(response)).toBe("UNAUTHENTICATED");
			}

			const refreshPath = "/core/v1/auth/refresh";
			const refreshBody = {
				refreshToken: sessions.ownerB.refreshToken,
			};
			const refresh = await command(
				undefined,
				refreshPath,
				"security-refresh-001",
				refreshBody,
			);
			expect(refresh.status).toBe(200);
			const refreshText = await refresh.text();
			const replacement = JSON.parse(refreshText) as Session;
			const refreshReplay = await command(
				undefined,
				refreshPath,
				"security-refresh-001",
				refreshBody,
			);
			expect(refreshReplay.status).toBe(200);
			expect(await refreshReplay.text()).toBe(refreshText);
			expect(refreshReplay.headers.get("Idempotency-Replayed")).toBe("true");
			const reuse = await command(
				undefined,
				refreshPath,
				"security-refresh-reuse",
				refreshBody,
			);
			expect(reuse.status).toBe(401);
			expect(await errorCode(reuse)).toBe("SESSION_REVOKED");
			const descendant = await command(
				undefined,
				refreshPath,
				"security-refresh-descendant",
				{ refreshToken: replacement.refreshToken },
			);
			expect(descendant.status).toBe(401);
			const bogus = await command(
				undefined,
				refreshPath,
				"security-refresh-bogus",
				{ refreshToken: `rt_${"x".repeat(43)}` },
			);
			expect(bogus.status).toBe(401);

			for (const authorization of [
				undefined,
				`Bearer ${sessions.ownerA.accessToken}`,
				"Bearer not-a-service-token",
			]) {
				const response = await fetch(
					`http://127.0.0.1:${userServer.port}/internal/v1/event-notifications`,
					{
						method: "POST",
						headers: authorization ? { Authorization: authorization } : {},
						body: "{}",
					},
				);
				expect(response.status).toBe(401);
				expect(await errorCode(response)).toBe("UNAUTHENTICATED");
			}

			const limitedGateway = createGatewayApp({
				config: gatewayConfig,
				clientIp: () => "198.51.100.91",
				rateLimiter: new MemoryRateLimiter(1, 60_000, 10),
			});
			const rateHeaders = {
				Authorization: `Bearer ${sessions.racerA.accessToken}`,
				"X-Forwarded-For": "203.0.113.1",
			};
			expect(
				(
					await limitedGateway.request("/core/v1/session", {
						headers: rateHeaders,
					})
				).status,
			).toBe(200);
			const limited = await limitedGateway.request("/core/v1/session", {
				headers: { ...rateHeaders, "X-Forwarded-For": "203.0.113.2" },
			});
			expect(limited.status).toBe(429);
			expect(limited.headers.get("Retry-After")).toBe("60");
		});

		test("prepublishes, cuts over and retires rolling RS256 keys without an auth gap", async () => {
			const [firstKeys, nextKeys, futureKeys] = await Promise.all([
				generateKeyPair("RS256", { modulusLength: 2048 }),
				generateKeyPair("RS256", { modulusLength: 2048 }),
				generateKeyPair("RS256", { modulusLength: 2048 }),
			]);
			const tokenOptions = { issuer, audience };
			const firstWithNextPublished = await createTokenService(
				firstKeys.privateKey,
				firstKeys.publicKey,
				{
					...tokenOptions,
					keyId: "rotation-k1",
					accessTokenTtlSeconds: 3,
					previous: {
						keyId: "rotation-k2",
						publicKey: nextKeys.publicKey,
					},
				},
			);
			const nextWithFirstRetained = await createTokenService(
				nextKeys.privateKey,
				nextKeys.publicKey,
				{
					...tokenOptions,
					keyId: "rotation-k2",
					accessTokenTtlSeconds: 10,
					previous: {
						keyId: "rotation-k1",
						publicKey: firstKeys.publicKey,
					},
				},
			);
			const futureWithNextRetained = await createTokenService(
				futureKeys.privateKey,
				futureKeys.publicKey,
				{
					...tokenOptions,
					keyId: "rotation-k3",
					accessTokenTtlSeconds: 10,
					previous: {
						keyId: "rotation-k2",
						publicKey: nextKeys.publicKey,
					},
				},
			);
			let activeTokens = firstWithNextPublished;
			const rotatingTokens: TokenService = {
				issueAccessToken: (input) => activeTokens.issueAccessToken(input),
				verifyAccessToken: (token) => activeTokens.verifyAccessToken(token),
				jwks: () => activeTokens.jwks(),
			};
			const rotatingUserApp = createUserApp({
				...userDependencies,
				tokens: rotatingTokens,
			});
			const rotatingUserServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => rotatingUserApp.fetch(request),
			});
			let rotatingEventServer: ReturnType<typeof Bun.serve> | undefined;
			try {
				const userUrl = `http://127.0.0.1:${rotatingUserServer.port}`;
				const jwksUrl = `${userUrl}/.well-known/jwks.json`;
				const rotatingEventApp = createEventApp({
					service: new EventService(
						new PostgresEventRepository(
							eventSql,
							new EventNotificationPayloadCodec({
								kid: "rotation-notification",
								key: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
							}),
						),
						"rotation-invitation-key-with-at-least-32-characters",
					),
					verifyUserToken: createEventJwtVerifier({
						jwksUrl,
						issuer,
						audience,
						cacheMaxAge: 1_000,
						cooldownDuration: 1_000,
						timeoutDuration: 2_000,
					}),
				});
				rotatingEventServer = Bun.serve({
					hostname: "127.0.0.1",
					port: 0,
					fetch: (request) => rotatingEventApp.fetch(request),
				});
				const eventUrl = `http://127.0.0.1:${rotatingEventServer.port}`;
				const rotatingGateway = createGatewayApp({
					config: loadGatewayConfig({
						USER_SERVICE_URL: userUrl,
						EVENT_SERVICE_URL: eventUrl,
						USER_SERVICE_JWKS_URL: jwksUrl,
						USER_TOKEN_ISSUER: issuer,
						USER_TOKEN_AUDIENCE: audience,
						JWKS_CACHE_MS: "1000",
						JWKS_COOLDOWN_MS: "1000",
						JWKS_TIMEOUT_MS: "2000",
						DOWNSTREAM_TIMEOUT_MS: "5000",
						RATE_LIMIT_MAX: "1000",
						RATE_LIMIT_MAX_ENTRIES: "1000",
					}),
					clientIp: () => "198.51.100.70",
					rateLimiter: new MemoryRateLimiter(1_000, 60_000, 1_000),
				});
				let loginSequence = 0;
				const rotationSignIn = async () => {
					loginSequence += 1;
					const magicToken = createOpaqueSecret("ml");
					await userRepository.createMagicLink({
						id: createId("ml"),
						email: "rotation@security.example",
						tokenHash: hashSecret(magicToken),
						expiresAt: new Date(Date.now() + 60_000),
					});
					const response = await rotatingGateway.request(
						"/core/v1/auth/magic-links/redeem",
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"Idempotency-Key": `rotation-login-${loginSequence}`,
							},
							body: JSON.stringify({ token: magicToken }),
						},
					);
					expect(response.status).toBe(200);
					return (await response.json()) as Session;
				};
				const rotationRead = (session: Session, path: string) =>
					rotatingGateway.request(path, {
						headers: { Authorization: `Bearer ${session.accessToken}` },
					});

				const first = await rotationSignIn();
				const firstIssuedAt = Date.now();
				expect(decodeProtectedHeader(first.accessToken).kid).toBe(
					"rotation-k1",
				);
				expect((await fetch(`${userUrl}/.well-known/jwks.json`)).ok).toBe(true);
				const prepublished = await (
					await fetch(`${userUrl}/.well-known/jwks.json`)
				).json();
				expect(
					prepublished.keys.map(({ kid }: { kid: string }) => kid),
				).toEqual(["rotation-k1", "rotation-k2"]);
				expect((await rotationRead(first, "/core/v1/session")).status).toBe(
					200,
				);
				const rootEventId = "evt_jwks_rotation";
				const created = await rotatingGateway.request("/core/v1/event-roots", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${first.accessToken}`,
						"Content-Type": "application/json",
						"Idempotency-Key": "rotation-root-create",
					},
					body: JSON.stringify(rootBody(rootEventId, "Rotation proof")),
				});
				expect(created.status).toBe(201);

				activeTokens = nextWithFirstRetained;
				const next = await rotationSignIn();
				expect(decodeProtectedHeader(next.accessToken).kid).toBe("rotation-k2");
				expect((await rotationRead(next, "/core/v1/session")).status).toBe(200);
				expect(
					(await rotationRead(next, `/core/v1/event-roots/${rootEventId}`))
						.status,
				).toBe(200);
				expect(
					(await rotationRead(first, `/core/v1/event-roots/${rootEventId}`))
						.status,
				).toBe(200);

				const futureToken = (
					await futureWithNextRetained.issueAccessToken({
						userId: next.user.id,
						sessionId: createId("ses"),
						email: next.user.email,
					})
				).accessToken;
				const unavailable = await rotatingGateway.request("/core/v1/session", {
					headers: { Authorization: `Bearer ${futureToken}` },
				});
				expect(unavailable.status).toBe(401);
				const unavailableText = await unavailable.text();
				expect(JSON.parse(unavailableText).error.code).toBe("UNAUTHENTICATED");
				expect(unavailableText).not.toContain("rotation-k3");
				expect(unavailableText).not.toContain(futureToken);
				const unavailableEvent = await fetch(
					`${eventUrl}/v1/event-roots/${rootEventId}`,
					{ headers: { Authorization: `Bearer ${futureToken}` } },
				);
				expect(unavailableEvent.status).toBe(401);
				const unavailableEventText = await unavailableEvent.text();
				expect(JSON.parse(unavailableEventText).error.code).toBe(
					"UNAUTHENTICATED",
				);
				expect(unavailableEventText).not.toContain("rotation-k3");
				expect(unavailableEventText).not.toContain(futureToken);

				const remainingFirstTtl = 3_100 - (Date.now() - firstIssuedAt);
				if (remainingFirstTtl > 0) {
					await new Promise((resolve) =>
						setTimeout(resolve, remainingFirstTtl),
					);
				}
				activeTokens = futureWithNextRetained;
				await new Promise((resolve) => setTimeout(resolve, 1_100));
				expect(
					(
						await rotatingGateway.request("/core/v1/session", {
							headers: { Authorization: `Bearer ${futureToken}` },
						})
					).status,
				).toBe(200);
				expect(
					(
						await rotatingGateway.request(
							`/core/v1/event-roots/${rootEventId}`,
							{ headers: { Authorization: `Bearer ${futureToken}` } },
						)
					).status,
				).toBe(200);
				expect(
					(
						await fetch(`${eventUrl}/v1/event-roots/${rootEventId}`, {
							headers: { Authorization: `Bearer ${futureToken}` },
						})
					).status,
				).toBe(200);
				expect((await rotationRead(next, "/core/v1/session")).status).toBe(200);
				expect((await rotationRead(first, "/core/v1/session")).status).toBe(
					401,
				);
				const retired = await (
					await fetch(`${userUrl}/.well-known/jwks.json`)
				).json();
				expect(retired.keys.map(({ kid }: { kid: string }) => kid)).toEqual([
					"rotation-k3",
					"rotation-k2",
				]);
				const [postgresProof] = await eventSql<
					{ roots: number; owners: number }[]
				>`
					SELECT count(*)::int AS roots,
						count(*) FILTER (WHERE membership.role = 'owner'
							AND membership.status = 'active')::int AS owners
					FROM event_roots root
					JOIN event_memberships membership
						ON membership.root_event_id = root.root_event_id
					WHERE root.root_event_id = ${rootEventId}
				`;
				expect(postgresProof).toEqual({ roots: 1, owners: 1 });
			} finally {
				rotatingEventServer?.stop(true);
				rotatingUserServer.stop(true);
			}
		});

		test("keeps PII, tokens and provider details out of service diagnostics", async () => {
			const requestIds = ["security-user-log", "security-event-log"] as const;
			const secrets = [
				"private.person@example.com",
				`Bearer ${sessions.ownerA.accessToken}`,
				sessions.ownerA.refreshToken,
				sensitiveInviteToken,
				"duplicate key row=(usr_private, private_payload)",
			];
			const inspected: string[] = [];
			const failure = new Error();
			for (const property of ["message", "detail", "stack", "row"]) {
				Object.defineProperty(failure, property, {
					configurable: true,
					get() {
						inspected.push(property);
						return secrets.join(" ");
					},
				});
			}
			Object.defineProperty(failure, "toJSON", {
				value() {
					inspected.push("toJSON");
					return { secrets };
				},
			});
			const logs: unknown[][] = [];
			const originalConsoleError = console.error;
			console.error = (...values: unknown[]) => logs.push(values);
			try {
				const userResponse = await createUserApp(userDependencies, () => {
					throw failure;
				}).request("/internal/ready", {
					headers: { "X-Request-ID": requestIds[0] },
				});
				const eventResponse = await createEventApp({
					readiness: () => {
						throw failure;
					},
				}).request("/internal/ready", {
					headers: { "X-Request-ID": requestIds[1] },
				});
				expect([userResponse.status, eventResponse.status]).toEqual([500, 500]);
				expect(await errorCode(userResponse)).toBe("INTERNAL_ERROR");
				expect(await errorCode(eventResponse)).toBe("INTERNAL_ERROR");
				expect(logs).toEqual([
					[
						"Unhandled request error",
						{ requestId: requestIds[0], code: "INTERNAL_ERROR" },
					],
					[
						"Unhandled request error",
						{ requestId: requestIds[1], code: "INTERNAL_ERROR" },
					],
				]);
				expect(inspected).toEqual([]);
				const publicOutput = JSON.stringify(logs);
				for (const secret of secrets) {
					expect(publicOutput).not.toContain(secret);
				}
			} finally {
				console.error = originalConsoleError;
			}
		});

		async function signIn(persona: Persona): Promise<Session> {
			const token = createOpaqueSecret("ml");
			const email = `${persona.toLowerCase()}@security.example`;
			await userRepository.createMagicLink({
				id: createId("ml"),
				email,
				tokenHash: hashSecret(token),
				expiresAt: new Date(Date.now() + 60_000),
			});
			const response = await command(
				undefined,
				"/core/v1/auth/magic-links/redeem",
				`security-login-${persona.toLowerCase()}`,
				{ token },
			);
			expect(response.status).toBe(200);
			return (await response.json()) as Session;
		}

		function rootBody(id: string, title: string) {
			return {
				id,
				kind: "team_event",
				title,
				description: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				status: "draft",
			};
		}

		async function read(session: Session, path: string) {
			return gateway.request(path, {
				headers: { Authorization: `Bearer ${session.accessToken}` },
			});
		}

		async function command(
			session: Session | undefined,
			path: string,
			idempotencyKey: string,
			body: unknown,
			method = "POST",
		) {
			return gateway.request(path, {
				method,
				headers: {
					...(session
						? { Authorization: `Bearer ${session.accessToken}` }
						: {}),
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify(body),
			});
		}

		async function createInviteResponse(
			session: Session,
			rootEventId: string,
			id: string,
			role: "organizer" | "participant" | "viewer",
			maxUses: number,
			idempotencyKey: string,
			normalizedEmailHint?: string,
			expiresAt = new Date(Date.now() + 60_000).toISOString(),
		) {
			return command(
				session,
				`/core/v1/event-roots/${rootEventId}/invitations`,
				idempotencyKey,
				{
					id,
					role,
					...(normalizedEmailHint ? { normalizedEmailHint } : {}),
					expiresAt,
					maxUses,
				},
			);
		}

		async function createInvite(
			session: Session,
			rootEventId: string,
			id: string,
			role: "organizer" | "participant" | "viewer",
			maxUses: number,
			idempotencyKey: string,
			normalizedEmailHint?: string,
			expiresAt?: string,
		) {
			const response = await createInviteResponse(
				session,
				rootEventId,
				id,
				role,
				maxUses,
				idempotencyKey,
				normalizedEmailHint,
				expiresAt,
			);
			expect(response.status).toBe(201);
			return (await response.json()) as {
				invitation: { id: string };
				token: string;
			};
		}

		function redeem(session: Session, token: string, idempotencyKey: string) {
			return command(session, "/core/v1/invitations/redeem", idempotencyKey, {
				token,
			});
		}

		function updateMembership(
			session: Session,
			rootEventId: string,
			userId: string,
			baseVersion: number,
			role: "organizer" | "participant" | "viewer",
			status: "active" | "left" | "removed",
			idempotencyKey: string,
		) {
			return command(
				session,
				`/core/v1/event-roots/${rootEventId}/memberships/${userId}`,
				idempotencyKey,
				{ baseVersion, role, status, reason: null },
				"PATCH",
			);
		}

		async function errorCode(response: Response) {
			return ((await response.clone().json()) as { error: { code: string } })
				.error.code;
		}

		async function attackToken(options: {
			algorithm?: "RS256" | "ES256";
			issuer?: string;
			audience?: string;
			subject?: string;
			expiresAt?: number;
			keyId?: string;
		}) {
			const algorithm = options.algorithm ?? "RS256";
			const now = Math.floor(Date.now() / 1_000);
			return new SignJWT({
				sid: "ses_00000000000000000000000000000001",
				email: "attacker@security.example",
				email_verified: true,
			})
				.setProtectedHeader({
					alg: algorithm,
					kid: options.keyId ?? keyId,
					typ: "JWT",
				})
				.setIssuer(options.issuer ?? issuer)
				.setAudience(options.audience ?? audience)
				.setSubject(options.subject ?? "usr_00000000000000000000000000000001")
				.setIssuedAt(now)
				.setExpirationTime(options.expiresAt ?? now + 300)
				.sign(algorithm === "ES256" ? ecPrivateKey : privateKey);
		}
	});
}
