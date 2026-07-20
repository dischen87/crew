import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import {
	type AuthenticatedUser,
	createId,
	createIdempotencyCodec,
	createOpaqueSecret,
	createRefreshToken,
	hashSecret,
	type IdempotencyCodec,
	type IdempotencyPayloadKeyring,
	type TokenService,
} from "./auth";
import type { DeliveryPayloadKeyring } from "./delivery-payload";
import {
	PUSH_CATEGORIES,
	PUSH_TEMPLATE_KEYS,
	type PushPayloadKeyring,
} from "./push-payload";
import type { AuthOperation, AuthRateLimiter } from "./rate-limit";
import type {
	Device,
	IdempotencyInput,
	Profile,
	StoredResponse,
	UserRepository,
} from "./repository";
import { PushFanoutLimitExceededError } from "./repository";
import { isSafeCorrelationId, logSafeFailure } from "./safe-error-log";
import type {
	EventNotificationServiceVerifier,
	MemberDirectoryServiceVerifier,
} from "./service-auth";

const SERVICE = "user-service";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EMAIL = z.string().trim().toLowerCase().email().max(254);
const AUTH_BODY_LIMIT_BYTES = 4_096;
const INTERNAL_NOTIFICATION_BODY_LIMIT_BYTES = 8_192;
const MEMBER_DIRECTORY_BODY_LIMIT_BYTES = 16_384;
const MAX_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const ANONYMOUS_IDEMPOTENCY_SCOPE = "anonymous:public-auth";
const PRIVATE_NO_STORE = "private, no-store";
const AUTH_RATE_LIMITS: Record<
	AuthOperation,
	{ client: number; subject: number }
> = {
	magicRequest: { client: 300, subject: 3 },
	magicRedeem: { client: 120, subject: 10 },
	refresh: { client: 300, subject: 20 },
};

type Variables = { requestId: string; actor?: AuthenticatedUser };
type UserServiceEnv = { Variables: Variables };
type ErrorDetail = { code: string; message: string; path?: string };
export type ClientKey = (context: Context<UserServiceEnv>) => string;

export type AppDependencies = {
	repository: UserRepository;
	tokens: TokenService;
	deliveryPayloads: DeliveryPayloadKeyring;
	pushPayloads?: PushPayloadKeyring;
	eventNotificationServiceVerifier?: EventNotificationServiceVerifier;
	memberDirectoryServiceVerifier?: MemberDirectoryServiceVerifier;
	authRateLimiter: AuthRateLimiter;
	clientKey?: ClientKey;
	magicLinkTtlSeconds: number;
	refreshTokenTtlSeconds: number;
	refreshTokenKey: string;
	idempotencyPayloadKeys: IdempotencyPayloadKeyring;
	now?: () => Date;
};

const ErrorDetailSchema = z
	.object({
		code: z.string(),
		path: z.string().optional(),
		message: z.string(),
	})
	.strict()
	.openapi("ErrorDetail");
const ErrorEnvelopeSchema = z
	.object({
		error: z
			.object({
				code: z.string(),
				message: z.string(),
				requestId: z.string(),
				retryable: z.boolean(),
				details: z.array(ErrorDetailSchema).optional(),
			})
			.strict(),
	})
	.strict()
	.openapi("ErrorEnvelope");
const ProfileSchema = z
	.object({
		displayName: z.string().nullable(),
		avatarUrl: z.string().url().nullable(),
		locale: z.string(),
		timeZone: z.string(),
		reduceMotion: z.boolean(),
		eventReminders: z.boolean(),
		productUpdates: z.boolean(),
		version: z.number().int().positive(),
		updatedAt: z.string().datetime(),
	})
	.strict()
	.openapi("Profile");
const UserSchema = z
	.object({
		id: z.string().regex(/^usr_[a-f0-9]{32}$/),
		email: EMAIL,
		profile: ProfileSchema,
	})
	.strict()
	.openapi("User");
const SessionSchema = z
	.object({
		accessToken: z.string(),
		refreshToken: z.string(),
		tokenType: z.literal("Bearer"),
		expiresInSeconds: z.number().int().positive(),
		user: UserSchema,
	})
	.strict()
	.openapi("Session");
const DeviceSchema = z
	.object({
		id: z.string().regex(/^dev_[a-f0-9]{32}$/),
		installationId: z.string(),
		platform: z.enum(["ios", "android"]),
		locale: z.string(),
		timeZone: z.string(),
		appVersion: z.string(),
		notificationsEnabled: z.boolean(),
		updatedAt: z.string().datetime(),
	})
	.strict()
	.openapi("Device");
const RequestIdHeader = {
	description: "Crew request correlation identifier",
	schema: { type: "string" as const },
};
const IdempotencyReplayHeader = {
	description: "Present with value true when a completed response is replayed",
	schema: { type: "string" as const, enum: ["true"] },
};
const RetryAfterHeader = {
	description: "Seconds until this request may be retried",
	schema: { type: "string" as const },
};
const CacheControlHeader = {
	description: "Prevents storage of credential and private-profile responses",
	schema: { type: "string" as const, enum: [PRIVATE_NO_STORE] },
};
const successHeaders = {
	"X-Request-ID": RequestIdHeader,
	"Idempotency-Replayed": IdempotencyReplayHeader,
};
const privateSuccessHeaders = {
	...successHeaders,
	"Cache-Control": CacheControlHeader,
};
const jsonError = (
	description: string,
	headers: Record<string, unknown> = {},
) => ({
	description,
	headers: { "X-Request-ID": RequestIdHeader, ...headers },
	content: { "application/json": { schema: ErrorEnvelopeSchema } },
});

const IdempotencyHeadersSchema = z.object({
	"idempotency-key": z
		.string()
		.min(8)
		.max(128)
		.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/)
		.openapi({
			example: "01J4Z3YQ4N6K8T2V5X7C9M1P3R",
		}),
});

const InternalNotificationHeadersSchema = z.object({
	"idempotency-key": z
		.string()
		.regex(/^job_[a-f0-9]{32}$/)
		.openapi({ description: "Event-worker job ID and durable dedupe key" }),
	"x-request-id": z
		.string()
		.regex(REQUEST_ID)
		.openapi({ description: "Original event-worker request ID" }),
	"x-causation-request-id": z
		.string()
		.regex(REQUEST_ID)
		.openapi({ description: "Original event-domain causation request ID" }),
});

const PushDeepLinkSchema = z
	.object({
		rootEventId: z.string().regex(/^evt_[A-Za-z0-9._:-]{1,96}$/),
		eventId: z
			.string()
			.regex(/^evt_[A-Za-z0-9._:-]{1,96}$/)
			.optional(),
		feedEntryId: z
			.string()
			.regex(/^fed_[A-Za-z0-9._:-]{1,96}$/)
			.optional(),
	})
	.strict()
	.openapi("PushDeepLink");

const EventNotificationIngressSchema = z
	.object({
		recipientUserId: z.string().regex(/^usr_[a-f0-9]{32}$/),
		category: z.enum(PUSH_CATEGORIES),
		templateKey: z.enum(PUSH_TEMPLATE_KEYS),
		deepLink: PushDeepLinkSchema,
		expiresAt: z.string().datetime({ offset: true }).openapi({
			description: "Expiry no more than 24 hours after ingress acceptance",
		}),
	})
	.strict()
	.openapi("EventNotificationIngress");

const UserIdSchema = z.string().regex(/^usr_[a-f0-9]{32}$/);
const RootEventIdSchema = z.string().regex(/^evt_[A-Za-z0-9._:-]{1,96}$/);
const MemberDirectoryProfileSchema = z
	.object({
		userId: UserIdSchema,
		displayName: z.string().nullable(),
		profileVersion: z.number().int().positive(),
	})
	.strict()
	.openapi("MemberDirectoryProfile");
const MemberDirectoryResolveSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootEventId: RootEventIdSchema,
		userIds: z.array(UserIdSchema).min(1).max(200),
	})
	.strict()
	.superRefine((value, context) => {
		if (new Set(value.userIds).size !== value.userIds.length) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "User IDs must be unique",
				path: ["userIds"],
			});
		}
	});
const MemberDirectoryResponseSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootEventId: RootEventIdSchema,
		profiles: z.array(MemberDirectoryProfileSchema).max(200),
	})
	.strict();

export class ServiceError extends Error {
	constructor(
		readonly status: ContentfulStatusCode,
		readonly code: string,
		message: string,
		readonly retryable = false,
		readonly details?: ErrorDetail[],
		readonly headers: Record<string, string> = {},
	) {
		super(message);
	}
}

function errorBody(
	requestId: string,
	code: string,
	message: string,
	retryable: boolean,
	details?: ErrorDetail[],
) {
	return {
		error: {
			code,
			message,
			requestId,
			retryable,
			...(details?.length ? { details } : {}),
		},
	};
}

const jwksRoute = createRoute({
	method: "get",
	path: "/.well-known/jwks.json",
	operationId: "identityJwksGet",
	tags: ["identity"],
	summary: "Get active access-token verification keys",
	security: [],
	responses: {
		200: {
			description: "JSON Web Key Set",
			headers: { "X-Request-ID": RequestIdHeader },
			content: {
				"application/json": {
					schema: z
						.object({
							keys: z.array(
								z
									.object({
										kty: z.literal("RSA"),
										n: z.string(),
										e: z.string(),
										alg: z.literal("RS256"),
										kid: z.string(),
										use: z.literal("sig"),
									})
									.strict(),
							),
						})
						.strict(),
				},
			},
		},
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "none",
});

const magicLinkRequestRoute = createRoute({
	method: "post",
	path: "/v1/auth/magic-links",
	operationId: "identityMagicLinksCreate",
	tags: ["identity"],
	summary: "Send a one-time sign-in link",
	security: [],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": { schema: z.object({ email: EMAIL }).strict() },
			},
		},
	},
	responses: {
		202: {
			description: "Request accepted without revealing account existence",
			headers: successHeaders,
			content: {
				"application/json": {
					schema: z.object({ accepted: z.literal(true) }).strict(),
				},
			},
		},
		400: jsonError("Invalid request"),
		409: jsonError("Idempotency conflict", {
			"Retry-After": RetryAfterHeader,
		}),
		413: jsonError("Payload too large"),
		429: jsonError("Rate limited", { "Retry-After": RetryAfterHeader }),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "required",
});

const magicLinkRedeemRoute = createRoute({
	method: "post",
	path: "/v1/auth/magic-links/redeem",
	operationId: "identityMagicLinksRedeem",
	tags: ["identity"],
	summary: "Redeem a one-time sign-in link",
	security: [],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({ token: z.string().regex(/^ml_[A-Za-z0-9_-]{43}$/) })
						.strict(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Authenticated session",
			headers: privateSuccessHeaders,
			content: { "application/json": { schema: SessionSchema } },
		},
		400: jsonError("Invalid request"),
		401: jsonError("Link invalid, expired, or already consumed", {
			"Idempotency-Replayed": IdempotencyReplayHeader,
		}),
		409: jsonError("Idempotency conflict", {
			"Retry-After": RetryAfterHeader,
		}),
		413: jsonError("Payload too large"),
		429: jsonError("Rate limited", { "Retry-After": RetryAfterHeader }),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "required",
});

const refreshRoute = createRoute({
	method: "post",
	path: "/v1/auth/refresh",
	operationId: "identitySessionsRefresh",
	tags: ["identity"],
	summary: "Rotate a refresh token and issue a new session",
	security: [],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							refreshToken: z.string().regex(/^rt_[A-Za-z0-9_-]{43}$/),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Rotated session",
			headers: privateSuccessHeaders,
			content: { "application/json": { schema: SessionSchema } },
		},
		400: jsonError("Invalid request"),
		401: jsonError("Refresh token invalid or session family revoked", {
			"Idempotency-Replayed": IdempotencyReplayHeader,
		}),
		409: jsonError("Idempotency conflict", {
			"Retry-After": RetryAfterHeader,
		}),
		413: jsonError("Payload too large"),
		429: jsonError("Rate limited", { "Retry-After": RetryAfterHeader }),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "required",
});

const eventNotificationIngressRoute = createRoute({
	method: "post",
	path: "/internal/v1/event-notifications",
	operationId: "identityEventNotificationsCreate",
	tags: ["internal"],
	summary: "Queue an event notification for the recipient's current devices",
	description:
		"Accepts an expiry no more than 24 hours ahead. More than 20 currently eligible devices is rejected atomically with 409; fanout is never truncated.",
	security: [{ serviceBearer: [] }],
	request: {
		headers: InternalNotificationHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": { schema: EventNotificationIngressSchema },
			},
		},
	},
	responses: {
		202: {
			description: "At least one per-device delivery was durably queued",
			headers: successHeaders,
			content: {
				"application/json": {
					schema: z
						.object({
							accepted: z.literal(true),
							queuedDevices: z.number().int().positive(),
						})
						.strict(),
				},
			},
		},
		204: {
			description:
				"Suppressed because the request expired or no currently eligible device exists",
			headers: successHeaders,
		},
		400: jsonError("Invalid request"),
		401: jsonError("Service authentication required"),
		409: jsonError("Idempotency or device-fanout conflict", {
			"Retry-After": RetryAfterHeader,
		}),
		413: jsonError("Payload too large"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "required",
});

const memberDirectoryResolveRoute = createRoute({
	method: "post",
	path: "/v1/member-directory-profiles/resolve",
	operationId: "usersMemberDirectoryProfilesResolve",
	tags: ["internal"],
	summary: "Resolve a bounded active-member page to public display fields",
	security: [{ serviceBearer: [] }],
	request: {
		body: {
			required: true,
			content: {
				"application/json": { schema: MemberDirectoryResolveSchema },
			},
		},
	},
	responses: {
		200: {
			description: "Exact ordered profile set",
			headers: privateSuccessHeaders,
			content: {
				"application/json": { schema: MemberDirectoryResponseSchema },
			},
		},
		400: jsonError("Invalid request"),
		401: jsonError("Service authentication required"),
		409: jsonError("Profile set incomplete"),
		500: jsonError("Unexpected failure"),
	},
	"x-gateway-compose-only": true,
	"x-idempotency": "natural",
	"x-max-decoded-body-bytes": MEMBER_DIRECTORY_BODY_LIMIT_BYTES,
});

const logoutRoute = createRoute({
	method: "post",
	path: "/v1/auth/logout",
	operationId: "identitySessionsRevoke",
	tags: ["identity"],
	summary: "Revoke the current refresh-session family",
	security: [{ userBearer: [] }],
	responses: {
		204: {
			description: "Session revoked",
			headers: { "X-Request-ID": RequestIdHeader },
		},
		401: jsonError("Authentication required"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "natural",
});

const meRoute = createRoute({
	method: "get",
	path: "/v1/me",
	operationId: "usersMeGet",
	tags: ["users"],
	summary: "Get the authenticated user's profile",
	security: [{ userBearer: [] }],
	responses: {
		200: {
			description: "Authenticated user",
			headers: {
				"X-Request-ID": RequestIdHeader,
				"Cache-Control": CacheControlHeader,
			},
			content: { "application/json": { schema: UserSchema } },
		},
		401: jsonError("Authentication required"),
		404: jsonError("User not found"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "none",
});

const profilePatchSchema = z
	.object({
		displayName: z.string().trim().min(1).max(120).nullable().optional(),
		avatarUrl: z.string().url().nullable().optional(),
		locale: z.string().min(2).max(35).optional(),
		timeZone: z.string().min(1).max(100).optional(),
		reduceMotion: z.boolean().optional(),
		eventReminders: z.boolean().optional(),
		productUpdates: z.boolean().optional(),
	})
	.strict()
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one profile field is required",
	);

const meUpdateRoute = createRoute({
	method: "patch",
	path: "/v1/me",
	operationId: "usersMeUpdate",
	tags: ["users"],
	summary: "Update the authenticated user's profile",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							changes: profilePatchSchema,
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Updated profile",
			headers: privateSuccessHeaders,
			content: { "application/json": { schema: ProfileSchema } },
		},
		400: jsonError("Invalid request"),
		401: jsonError("Authentication required"),
		409: jsonError("Profile version or idempotency conflict", {
			"Idempotency-Replayed": IdempotencyReplayHeader,
			"Retry-After": RetryAfterHeader,
		}),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "required",
});

const devicesRoute = createRoute({
	method: "get",
	path: "/v1/me/devices",
	operationId: "usersDevicesList",
	tags: ["devices"],
	summary: "List the authenticated user's devices",
	security: [{ userBearer: [] }],
	responses: {
		200: {
			description: "Registered devices",
			headers: { "X-Request-ID": RequestIdHeader },
			content: {
				"application/json": {
					schema: z.object({ items: z.array(DeviceSchema) }).strict(),
				},
			},
		},
		401: jsonError("Authentication required"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "none",
});

const installationIdParameter = z
	.object({ installationId: z.string().regex(/^dvc_[A-Za-z0-9._:-]{8,128}$/) })
	.strict();
const deviceInputSchema = z
	.object({
		platform: z.enum(["ios", "android"]),
		pushToken: z.string().min(16).max(4096).nullable(),
		locale: z.string().min(2).max(35),
		timeZone: z.string().min(1).max(100),
		appVersion: z.string().min(1).max(64),
		notificationsEnabled: z.boolean(),
	})
	.strict();

const devicePutRoute = createRoute({
	method: "put",
	path: "/v1/me/devices/{installationId}",
	operationId: "usersDevicesUpsert",
	tags: ["devices"],
	summary: "Register or refresh one installation",
	security: [{ userBearer: [] }],
	request: {
		params: installationIdParameter,
		body: {
			required: true,
			content: { "application/json": { schema: deviceInputSchema } },
		},
	},
	responses: {
		200: {
			description: "Registered device",
			headers: { "X-Request-ID": RequestIdHeader },
			content: { "application/json": { schema: DeviceSchema } },
		},
		400: jsonError("Invalid request"),
		401: jsonError("Authentication required"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "natural",
});

const deviceDeleteRoute = createRoute({
	method: "delete",
	path: "/v1/me/devices/{installationId}",
	operationId: "usersDevicesDelete",
	tags: ["devices"],
	summary: "Remove one of the authenticated user's installations",
	security: [{ userBearer: [] }],
	request: { params: installationIdParameter },
	responses: {
		204: {
			description: "Device removed or already absent",
			headers: { "X-Request-ID": RequestIdHeader },
		},
		400: jsonError("Invalid request"),
		401: jsonError("Authentication required"),
		500: jsonError("Unexpected failure"),
	},
	"x-idempotency": "natural",
});

export function createApp(
	dependencies: AppDependencies,
	readiness: () => boolean | Promise<boolean> = () => true,
) {
	const now = dependencies.now ?? (() => new Date());
	const idempotencyCodec = createIdempotencyCodec(
		dependencies.idempotencyPayloadKeys,
	);
	const app = new OpenAPIHono<UserServiceEnv>({
		defaultHook(result, c) {
			if (result.success) return;
			const details = result.error.issues.map((issue) => ({
				code: issue.code.toUpperCase(),
				message: issue.message,
				...(issue.path.length ? { path: `/${issue.path.join("/")}` } : {}),
			}));
			return c.json(
				errorBody(
					c.get("requestId"),
					"VALIDATION_FAILED",
					"The request is invalid.",
					false,
					details,
				),
				400,
			);
		},
	});

	app.use(
		"*",
		createMiddleware<UserServiceEnv>(async (c, next) => {
			const incoming = c.req.header("x-request-id");
			const requestId =
				incoming && isSafeCorrelationId(incoming)
					? incoming
					: crypto.randomUUID();
			c.set("requestId", requestId);
			c.header("X-Request-ID", requestId);
			await next();
		}),
	);
	app.use("/v1/auth/*", boundedBody(AUTH_BODY_LIMIT_BYTES));
	const authenticate = createMiddleware<UserServiceEnv>(async (c, next) => {
		const token = /^Bearer ([^\s]+)$/i.exec(
			c.req.header("authorization") ?? "",
		)?.[1];
		if (!token)
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		try {
			c.set("actor", await dependencies.tokens.verifyAccessToken(token));
		} catch {
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		}
		await next();
	});
	const authenticateEventService = createMiddleware<UserServiceEnv>(
		async (c, next) => {
			const token = /^Bearer ([^\s]+)$/i.exec(
				c.req.header("authorization") ?? "",
			)?.[1];
			let authenticated = false;
			if (token) {
				try {
					authenticated =
						(await dependencies.eventNotificationServiceVerifier?.verify(
							token,
						)) ?? false;
				} catch {
					authenticated = false;
				}
			}
			if (!authenticated) {
				throw new ServiceError(
					401,
					"UNAUTHENTICATED",
					"Service authentication is required.",
				);
			}
			await next();
		},
	);
	const authenticateMemberDirectoryService = createMiddleware<UserServiceEnv>(
		async (c, next) => {
			const token = /^Bearer ([^\s]+)$/i.exec(
				c.req.header("authorization") ?? "",
			)?.[1];
			let authenticated = false;
			if (token) {
				try {
					authenticated =
						(await dependencies.memberDirectoryServiceVerifier?.verify(
							token,
						)) ?? false;
				} catch {
					authenticated = false;
				}
			}
			if (!authenticated) {
				throw new ServiceError(
					401,
					"UNAUTHENTICATED",
					"Service authentication is required.",
				);
			}
			await next();
		},
	);

	app.get("/internal/live", (c) => c.json({ service: SERVICE, status: "ok" }));
	app.get("/internal/ready", async (c) => {
		if (await readiness())
			return c.json({ service: SERVICE, status: "ready" }, 200);
		return c.json(
			errorBody(
				c.get("requestId"),
				"SERVICE_UNAVAILABLE",
				"Service is not ready.",
				true,
			),
			503,
		);
	});

	app.openapi(jwksRoute, (c) =>
		c.json(dependencies.tokens.jwks() as never, 200),
	);
	app.openapi(magicLinkRequestRoute, async (c) => {
		const { email } = c.req.valid("json");
		const requestedAt = now();
		const input = idempotencyInput({
			scope: ANONYMOUS_IDEMPOTENCY_SCOPE,
			operationId: "identityMagicLinksCreate",
			key: c.req.valid("header")["idempotency-key"],
			method: "POST",
			path: "/v1/auth/magic-links",
			body: { email },
			now: requestedAt,
		});
		const outcome = await executeIdempotentRequest(
			dependencies.repository,
			idempotencyCodec,
			input,
			c.get("requestId"),
			async (repository) => {
				await checkAuthRateLimit(
					dependencies,
					c,
					"magicRequest",
					"email",
					email,
					requestedAt,
				);
				const token = createOpaqueSecret("ml");
				const expiresAt = new Date(
					requestedAt.getTime() + dependencies.magicLinkTtlSeconds * 1_000,
				);
				const jobId = createId("job");
				await repository.createMagicLinkWithDelivery({
					link: {
						id: createId("ml"),
						email,
						tokenHash: hashSecret(token),
						expiresAt,
					},
					delivery: {
						id: jobId,
						sealedPayload: dependencies.deliveryPayloads.seal(jobId, {
							email,
							token,
							expiresAt,
						}),
						createdAt: requestedAt,
					},
				});
				return { status: 202, body: { accepted: true }, headers: {} };
			},
		);
		return idempotentJson(c, outcome) as never;
	});

	app.openapi(magicLinkRedeemRoute, async (c) => {
		const { token } = c.req.valid("json");
		const redeemedAt = now();
		const input = idempotencyInput({
			scope: ANONYMOUS_IDEMPOTENCY_SCOPE,
			operationId: "identityMagicLinksRedeem",
			key: c.req.valid("header")["idempotency-key"],
			method: "POST",
			path: "/v1/auth/magic-links/redeem",
			body: { token },
			now: redeemedAt,
		});
		const outcome = await executeIdempotentRequest(
			dependencies.repository,
			idempotencyCodec,
			input,
			c.get("requestId"),
			async (repository) => {
				await checkAuthRateLimit(
					dependencies,
					c,
					"magicRedeem",
					"token",
					token,
					redeemedAt,
				);
				const newSessionId = createId("ses");
				const refreshToken = createRefreshToken(
					newSessionId,
					dependencies.refreshTokenKey,
				);
				const result = await repository.redeemMagicLink({
					tokenHash: hashSecret(token),
					now: redeemedAt,
					newUserId: createId("usr"),
					newSessionId,
					refreshTokenHash: hashSecret(refreshToken),
					sessionExpiresAt: new Date(
						redeemedAt.getTime() + dependencies.refreshTokenTtlSeconds * 1_000,
					),
				});
				if (!result) {
					return {
						status: 401,
						body: errorBody(
							c.get("requestId"),
							"MAGIC_LINK_INVALID",
							"The sign-in link is invalid or expired.",
							false,
						),
						headers: {},
					};
				}
				return {
					status: 200,
					body: await sessionResponse(
						dependencies.tokens,
						result,
						refreshToken,
					),
					headers: { "Cache-Control": PRIVATE_NO_STORE },
				};
			},
			activeSessionReplayGuard(redeemedAt),
		);
		return idempotentJson(c, outcome) as never;
	});

	app.openapi(refreshRoute, async (c) => {
		const { refreshToken: currentToken } = c.req.valid("json");
		const refreshedAt = now();
		const input = idempotencyInput({
			scope: ANONYMOUS_IDEMPOTENCY_SCOPE,
			operationId: "identitySessionsRefresh",
			key: c.req.valid("header")["idempotency-key"],
			method: "POST",
			path: "/v1/auth/refresh",
			body: { refreshToken: currentToken },
			now: refreshedAt,
		});
		const outcome = await executeIdempotentRequest(
			dependencies.repository,
			idempotencyCodec,
			input,
			c.get("requestId"),
			async (repository) => {
				await checkAuthRateLimit(
					dependencies,
					c,
					"refresh",
					"token",
					currentToken,
					refreshedAt,
				);
				const newSessionId = createId("ses");
				const replacementToken = createRefreshToken(
					newSessionId,
					dependencies.refreshTokenKey,
				);
				const result = await repository.rotateRefreshToken({
					tokenHash: hashSecret(currentToken),
					now: refreshedAt,
					newSessionId,
					newRefreshTokenHash: hashSecret(replacementToken),
					sessionExpiresAt: new Date(
						refreshedAt.getTime() + dependencies.refreshTokenTtlSeconds * 1_000,
					),
				});
				if (result.kind !== "ok") {
					return {
						status: 401,
						body: errorBody(
							c.get("requestId"),
							result.kind === "reuse" ? "SESSION_REVOKED" : "UNAUTHENTICATED",
							"The session cannot be refreshed.",
							false,
						),
						headers: {},
					};
				}
				return {
					status: 200,
					body: await sessionResponse(
						dependencies.tokens,
						result,
						replacementToken,
					),
					headers: { "Cache-Control": PRIVATE_NO_STORE },
				};
			},
			activeSessionReplayGuard(refreshedAt),
		);
		return idempotentJson(c, outcome) as never;
	});

	app.use("/internal/v1/event-notifications", authenticateEventService);
	app.use(
		"/internal/v1/event-notifications",
		boundedBody(INTERNAL_NOTIFICATION_BODY_LIMIT_BYTES),
	);
	app.openapi(eventNotificationIngressRoute, async (c) => {
		const headers = c.req.valid("header");
		const body = c.req.valid("json");
		const acceptedAt = now();
		const expiresAt = new Date(body.expiresAt);
		if (expiresAt.getTime() > acceptedAt.getTime() + MAX_NOTIFICATION_TTL_MS) {
			throw new ServiceError(
				400,
				"EXPIRY_TOO_FAR",
				"Notification expiry must be within 24 hours.",
			);
		}
		const eventJobId = headers["idempotency-key"];
		const causationRequestId = headers["x-causation-request-id"];
		const pushPayloads = dependencies.pushPayloads;
		if (!pushPayloads) throw new Error("Push payload keyring is unavailable");
		const input = idempotencyInput({
			scope: "service:event-notifications",
			operationId: "identityEventNotificationsCreate",
			key: eventJobId,
			method: "POST",
			path: "/internal/v1/event-notifications",
			body: { ...body, causationRequestId },
			now: acceptedAt,
		});
		const outcome = await executeIdempotentRequest(
			dependencies.repository,
			idempotencyCodec,
			input,
			c.get("requestId"),
			async (repository) => {
				let queuedDevices: number;
				try {
					queuedDevices = await repository.enqueuePushNotification({
						eventJobId,
						recipientUserId: body.recipientUserId,
						category: body.category,
						templateKey: body.templateKey,
						deepLink: {
							rootEventId: body.deepLink.rootEventId,
							...(body.deepLink.eventId
								? { eventId: body.deepLink.eventId }
								: {}),
							...(body.deepLink.feedEntryId
								? { feedEntryId: body.deepLink.feedEntryId }
								: {}),
						},
						expiresAt,
						requestId: headers["x-request-id"],
						causationRequestId,
						createdAt: acceptedAt,
						payloads: pushPayloads,
					});
				} catch (error) {
					if (!(error instanceof PushFanoutLimitExceededError)) throw error;
					return {
						status: 409,
						body: errorBody(
							c.get("requestId"),
							"DEVICE_FANOUT_LIMIT_EXCEEDED",
							"The recipient has more than 20 active devices.",
							false,
						),
						headers: {},
					};
				}
				if (queuedDevices === 0) {
					return { status: 204, body: null, headers: {} };
				}
				return {
					status: 202,
					body: { accepted: true, queuedDevices },
					headers: {},
				};
			},
		);
		return idempotentResponse(c, outcome) as never;
	});

	app.use(
		"/v1/member-directory-profiles/resolve",
		authenticateMemberDirectoryService,
	);
	app.use(
		"/v1/member-directory-profiles/resolve",
		boundedBody(MEMBER_DIRECTORY_BODY_LIMIT_BYTES),
	);
	app.openapi(memberDirectoryResolveRoute, async (c) => {
		const body = c.req.valid("json");
		const profiles =
			await dependencies.repository.resolveMemberDirectoryProfiles(
				body.userIds,
			);
		if (
			profiles.length !== body.userIds.length ||
			profiles.some((profile, index) => profile.userId !== body.userIds[index])
		) {
			throw new ServiceError(
				409,
				"DIRECTORY_PROFILE_SET_INCOMPLETE",
				"The requested profile set is incomplete.",
			);
		}
		return c.json(
			{
				schemaVersion: 1 as const,
				rootEventId: body.rootEventId,
				profiles: profiles.map((profile) => ({
					userId: profile.userId,
					displayName: profile.displayName,
					profileVersion: profile.version,
				})),
			},
			200,
			{ "Cache-Control": PRIVATE_NO_STORE },
		);
	});

	app.use("/v1/auth/logout", authenticate);
	app.use("/v1/me", authenticate);
	app.use("/v1/me/*", authenticate);

	app.openapi(logoutRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		await dependencies.repository.revokeSessionFamily(
			actor.userId,
			actor.sessionId,
			now(),
		);
		return c.body(null, 204);
	});
	app.openapi(meRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		const [user, profile] = await Promise.all([
			dependencies.repository.getUser(actor.userId),
			dependencies.repository.getProfile(actor.userId),
		]);
		if (!user || !profile)
			throw new ServiceError(404, "NOT_FOUND", "User not found.");
		return c.json(userResponse(user.id, user.email, profile), 200, {
			"Cache-Control": PRIVATE_NO_STORE,
		});
	});
	app.openapi(meUpdateRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		const { baseVersion, changes } = c.req.valid("json");
		const updatedAt = now();
		const definedChanges = Object.fromEntries(
			Object.entries(changes).filter((entry) => entry[1] !== undefined),
		);
		const input = idempotencyInput({
			scope: `user:${actor.userId}`,
			operationId: "usersMeUpdate",
			key: c.req.valid("header")["idempotency-key"],
			method: "PATCH",
			path: "/v1/me",
			body: { baseVersion, changes: definedChanges },
			now: updatedAt,
		});
		const outcome = await executeIdempotentRequest(
			dependencies.repository,
			idempotencyCodec,
			input,
			c.get("requestId"),
			async (repository) => {
				const profile = await repository.updateProfile(
					actor.userId,
					baseVersion,
					definedChanges,
					updatedAt,
				);
				if (!profile) {
					return {
						status: 409,
						body: errorBody(
							c.get("requestId"),
							"VERSION_CONFLICT",
							"The profile changed on another device.",
							false,
						),
						headers: {},
					};
				}
				return {
					status: 200,
					body: profileResponse(profile),
					headers: { "Cache-Control": PRIVATE_NO_STORE },
				};
			},
		);
		return idempotentJson(c, outcome) as never;
	});
	app.openapi(devicesRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		const items = await dependencies.repository.listDevices(actor.userId);
		return c.json({ items: items.map(deviceResponse) }, 200);
	});
	app.openapi(devicePutRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		const { installationId } = c.req.valid("param");
		const device = await dependencies.repository.upsertDevice(
			actor.userId,
			{ installationId, ...c.req.valid("json") },
			now(),
		);
		return c.json(deviceResponse(device), 200);
	});
	app.openapi(deviceDeleteRoute, async (c) => {
		const actor = requiredActor(c.get("actor"));
		await dependencies.repository.removeDevice(
			actor.userId,
			c.req.valid("param").installationId,
		);
		return c.body(null, 204);
	});

	app.openAPIRegistry.registerComponent("securitySchemes", "userBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
	});
	app.openAPIRegistry.registerComponent("securitySchemes", "serviceBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description:
			"Short-lived purpose-scoped HS256 service JWT with current/previous KID, pinned issuer, audience, subject and expiry",
	});
	app.doc31("/docs/openapi.json", {
		openapi: "3.1.0",
		info: { title: "Crew User Service", version: "0.1.0" },
	});
	app.get("/docs", apiReference({ url: "/docs/openapi.json" }));
	app.notFound((c) =>
		c.json(
			errorBody(c.get("requestId"), "NOT_FOUND", "Resource not found.", false),
			404,
		),
	);
	app.onError((error, c) => {
		if (error instanceof ServiceError) {
			for (const [name, value] of Object.entries(error.headers)) {
				c.header(name, value);
			}
			return c.json(
				errorBody(
					c.get("requestId"),
					error.code,
					error.message,
					error.retryable,
					error.details,
				),
				error.status,
			);
		}
		if (error instanceof HTTPException && error.status === 400) {
			return c.json(
				errorBody(
					c.get("requestId"),
					"VALIDATION_FAILED",
					"The request is invalid.",
					false,
				),
				400,
			);
		}
		logSafeFailure("request", c.get("requestId"));
		return c.json(
			errorBody(
				c.get("requestId"),
				"INTERNAL_ERROR",
				"Internal server error.",
				false,
			),
			500,
		);
	});
	return app;
}

type HttpCommandResponse = {
	status: StatusCode;
	body: unknown;
	headers: Record<string, string>;
};

type IdempotentHttpOutcome = HttpCommandResponse & { replayed: boolean };

function idempotencyInput(input: {
	scope: string;
	operationId: string;
	key: string;
	method: string;
	path: string;
	body: unknown;
	now: Date;
}): IdempotencyInput {
	return {
		scope: input.scope,
		operationId: input.operationId,
		key: input.key,
		fingerprint: hashSecret(
			JSON.stringify(
				canonicalize({
					body: input.body,
					method: input.method,
					path: input.path,
				}),
			),
		),
		now: input.now,
		expiresAt: new Date(input.now.getTime() + IDEMPOTENCY_RETENTION_MS),
	};
}

async function executeIdempotentRequest(
	repository: UserRepository,
	codec: IdempotencyCodec,
	input: IdempotencyInput,
	requestId: string,
	operation: (repository: UserRepository) => Promise<HttpCommandResponse>,
	replayGuard?: (
		repository: UserRepository,
		response: HttpCommandResponse,
	) => Promise<void>,
): Promise<IdempotentHttpOutcome> {
	const result = await repository.executeIdempotent(
		input,
		async (transactionRepository): Promise<StoredResponse> => {
			const response = await operation(transactionRepository);
			if (response.status >= 500) {
				throw new Error("A 5xx response cannot complete an idempotency record");
			}
			const headers = responseHeadersForStorage(response.headers);
			return {
				status: response.status,
				body: codec.seal(
					responseBodyForStorage(response.body),
					responseAssociatedData(input, response.status, headers),
				),
				headers,
			};
		},
		replayGuard
			? async (transactionRepository, stored) => {
					await replayGuard(transactionRepository, {
						status: stored.status as StatusCode,
						body: codec.open(
							stored.body,
							responseAssociatedData(input, stored.status, stored.headers),
						),
						headers: stored.headers,
					});
				}
			: undefined,
	);

	if (result.kind === "conflict") {
		throw new ServiceError(
			409,
			"IDEMPOTENCY_KEY_REUSED",
			"The idempotency key was already used for a different request.",
		);
	}
	if (result.kind === "in_progress") {
		throw new ServiceError(
			409,
			"IDEMPOTENCY_IN_PROGRESS",
			"A request with this idempotency key is still in progress.",
			true,
			undefined,
			{ "Retry-After": "1" },
		);
	}

	return {
		status: result.response.status as StatusCode,
		body: responseBodyForRequest(
			codec.open(
				result.response.body,
				responseAssociatedData(
					input,
					result.response.status,
					result.response.headers,
				),
			),
			requestId,
		),
		headers: result.response.headers,
		replayed: result.kind === "replayed",
	};
}

function idempotentJson(
	context: Context<UserServiceEnv>,
	outcome: IdempotentHttpOutcome,
) {
	return idempotentResponse(context, outcome);
}

function idempotentResponse(
	context: Context<UserServiceEnv>,
	outcome: IdempotentHttpOutcome,
) {
	for (const [name, value] of Object.entries(outcome.headers)) {
		context.header(name, value);
	}
	if (outcome.replayed) context.header("Idempotency-Replayed", "true");
	if (outcome.status === 204) return context.body(null, 204);
	return context.json(
		outcome.body as never,
		outcome.status as ContentfulStatusCode,
	);
}

function responseHeadersForStorage(headers: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(headers).filter(
			([name]) =>
				!new Set(["x-request-id", "idempotency-replayed"]).has(
					name.toLowerCase(),
				),
		),
	);
}

function responseBodyForStorage(body: unknown) {
	const stored = structuredClone(body);
	if (isRecord(stored) && isRecord(stored.error)) {
		delete stored.error.requestId;
	}
	return stored;
}

function responseBodyForRequest(body: unknown, requestId: string) {
	const response = structuredClone(body);
	if (isRecord(response) && isRecord(response.error)) {
		response.error.requestId = requestId;
	}
	return response;
}

function responseAssociatedData(
	input: IdempotencyInput,
	status: number,
	headers: Record<string, string>,
) {
	return [
		input.scope,
		input.operationId,
		input.key,
		input.fingerprint,
		String(status),
		JSON.stringify(canonicalize(headers)),
	].join("\0");
}

function activeSessionReplayGuard(now: Date) {
	return async (repository: UserRepository, response: HttpCommandResponse) => {
		if (response.status >= 400) return;
		const refreshToken =
			isRecord(response.body) && typeof response.body.refreshToken === "string"
				? response.body.refreshToken
				: null;
		if (
			!refreshToken ||
			!/^rt_[A-Za-z0-9_-]{43}$/.test(refreshToken) ||
			!(await repository.isRefreshSessionActive(hashSecret(refreshToken), now))
		) {
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"The session is no longer active.",
			);
		}
	};
}

async function checkAuthRateLimit(
	dependencies: AppDependencies,
	context: Context<UserServiceEnv>,
	operation: AuthOperation,
	subjectKind: "email" | "token",
	subject: string,
	at: Date,
): Promise<void> {
	const policy = AUTH_RATE_LIMITS[operation];
	const client = (dependencies.clientKey ?? bunClientKey)(context);
	let decision: Awaited<ReturnType<AuthRateLimiter["consume"]>>;
	try {
		decision = await dependencies.authRateLimiter.consume(
			operation,
			[
				{ key: `client:${client}`, limit: policy.client },
				{ key: `${subjectKind}:${subject}`, limit: policy.subject },
			],
			at.getTime(),
		);
	} catch {
		throw new ServiceError(
			503,
			"SERVICE_UNAVAILABLE",
			"Service is temporarily unavailable.",
			true,
			undefined,
			{ "Retry-After": "1" },
		);
	}
	if (!decision.allowed) {
		throw new ServiceError(
			429,
			"RATE_LIMITED",
			"Too many authentication requests.",
			true,
			undefined,
			{ "Retry-After": String(decision.retryAfterSeconds) },
		);
	}
}

function bunClientKey(context: Context<UserServiceEnv>) {
	try {
		return getConnInfo(context).remote.address ?? "unknown";
	} catch {
		return "unknown";
	}
}

function boundedBody(maxSize: number) {
	return createMiddleware<UserServiceEnv>(async (context, next) => {
		const body = context.req.raw.body;
		if (!body) return next();
		const contentLength = context.req.header("content-length");
		if (contentLength && Number(contentLength) > maxSize) {
			return payloadTooLarge(context);
		}

		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxSize) {
				await reader.cancel();
				return payloadTooLarge(context);
			}
			chunks.push(value);
		}
		const requestInit = {
			body: Buffer.concat(chunks),
			duplex: "half",
		} as RequestInit & { duplex: "half" };
		context.req.raw = new Request(context.req.raw, requestInit);
		await next();
	});
}

function payloadTooLarge(context: Context<UserServiceEnv>) {
	return context.json(
		errorBody(
			context.get("requestId"),
			"PAYLOAD_TOO_LARGE",
			"The request body is too large.",
			false,
		),
		413,
	);
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value)
				.filter((entry) => entry[1] !== undefined)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, entry]) => [key, canonicalize(entry)]),
		);
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredActor(actor: AuthenticatedUser | undefined) {
	if (!actor)
		throw new ServiceError(
			401,
			"UNAUTHENTICATED",
			"Authentication is required.",
		);
	return actor;
}

async function sessionResponse(
	tokens: TokenService,
	result: {
		user: { id: string; email: string };
		profile: Profile;
		sessionId: string;
	},
	refreshToken: string,
) {
	const access = await tokens.issueAccessToken({
		userId: result.user.id,
		sessionId: result.sessionId,
		email: result.user.email,
	});
	return {
		...access,
		refreshToken,
		tokenType: "Bearer" as const,
		user: userResponse(result.user.id, result.user.email, result.profile),
	};
}

function userResponse(id: string, email: string, profile: Profile) {
	return { id, email, profile: profileResponse(profile) };
}

function profileResponse(profile: Profile) {
	return {
		displayName: profile.displayName,
		avatarUrl: profile.avatarUrl,
		locale: profile.locale,
		timeZone: profile.timeZone,
		reduceMotion: profile.reduceMotion,
		eventReminders: profile.eventReminders,
		productUpdates: profile.productUpdates,
		version: profile.version,
		updatedAt: profile.updatedAt.toISOString(),
	};
}

function deviceResponse(device: Device) {
	return {
		id: device.id,
		installationId: device.installationId,
		platform: device.platform,
		locale: device.locale,
		timeZone: device.timeZone,
		appVersion: device.appVersion,
		notificationsEnabled: device.notificationsEnabled,
		updatedAt: device.updatedAt.toISOString(),
	};
}
