import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import type { Config } from "./config";
import { loadConfig } from "./config";
import { findProxyRoute, gatewayContract } from "./contracts";
import type { GatewayEnv } from "./http";
import {
	ErrorEnvelopeSchema,
	errorBody,
	RequestIdHeader,
	requestIdMiddleware,
	ServiceError,
} from "./http";
import { memberDirectoryRequest } from "./member-directory";
import { type Fetch, proxyRequest } from "./proxy";
import type { ClientIp, RateLimiter, VerifyUserToken } from "./security";
import {
	createClientIp,
	createJwtVerifier,
	enforceRateLimit,
	rateLimitMiddleware,
	userAuthMiddleware,
} from "./security";

const SERVICE = "api-gateway";

const HealthSchema = z
	.object({ service: z.literal(SERVICE), status: z.enum(["ok", "ready"]) })
	.strict();
const SessionSchema = z
	.object({
		actor: z.object({ id: z.string().regex(/^usr_[a-f0-9]{32}$/) }).strict(),
	})
	.strict()
	.openapi("Session");
const RetryAfterHeader = {
	description: "Seconds until this principal may retry",
	schema: { type: "string" as const },
};
const EventIdSchema = z.string().regex(/^evt_[A-Za-z0-9._:-]{1,96}$/);
const UserIdSchema = z.string().regex(/^usr_[a-f0-9]{32}$/);
const PageInfoSchema = z
	.object({ nextCursor: z.string().nullable(), hasMore: z.boolean() })
	.strict();
const MemberDirectoryResponseSchema = z
	.object({
		items: z
			.array(
				z
					.object({
						userId: UserIdSchema,
						displayName: z.string().nullable(),
					})
					.strict(),
			)
			.max(200),
		pageInfo: PageInfoSchema,
	})
	.strict()
	.openapi("MemberDirectoryPage");

const sessionRoute = createRoute({
	method: "get",
	path: "/core/v1/session",
	operationId: "usersSessionGet",
	tags: ["users"],
	summary: "Return the verified session actor",
	description:
		"Returns only the actor derived from the verified access-token subject.",
	security: [{ userBearer: [] }],
	responses: {
		200: {
			description: "Verified session",
			headers: { "X-Request-ID": RequestIdHeader },
			content: { "application/json": { schema: SessionSchema } },
		},
		401: {
			description: "Authentication required",
			headers: { "X-Request-ID": RequestIdHeader },
			content: { "application/json": { schema: ErrorEnvelopeSchema } },
		},
		429: {
			description: "Rate limited",
			headers: {
				"X-Request-ID": RequestIdHeader,
				"Retry-After": RetryAfterHeader,
			},
			content: { "application/json": { schema: ErrorEnvelopeSchema } },
		},
		500: {
			description: "Unexpected failure",
			headers: { "X-Request-ID": RequestIdHeader },
			content: { "application/json": { schema: ErrorEnvelopeSchema } },
		},
	},
	"x-idempotency": "none",
});

const memberDirectoryRoute = createRoute({
	method: "get",
	path: "/core/v1/event-roots/{rootEventId}/member-directory",
	operationId: "eventMemberDirectoryGet",
	tags: ["memberships"],
	summary: "List active event members with their current display names",
	security: [{ userBearer: [] }],
	request: {
		params: z.object({ rootEventId: EventIdSchema }).strict(),
		query: z
			.object({
				limit: z.coerce.number().int().min(1).max(200).default(50),
				cursor: z.string().min(16).max(4096).optional(),
			})
			.strict(),
	},
	responses: {
		200: {
			description: "Active member directory page",
			headers: {
				"X-Request-ID": RequestIdHeader,
				"Cache-Control": {
					description: "Prevents storage of private membership data",
					schema: {
						type: "string" as const,
						enum: ["private, no-store"],
					},
				},
			},
			content: {
				"application/json": { schema: MemberDirectoryResponseSchema },
			},
		},
		400: edgeErrorResponse("Invalid request"),
		401: edgeErrorResponse("Authentication required"),
		404: edgeErrorResponse("Resource not found"),
		429: edgeErrorResponse("Rate limited", true),
		502: edgeErrorResponse("Invalid upstream response"),
		503: edgeErrorResponse("Required service unavailable"),
		504: edgeErrorResponse("Required service timeout"),
		500: edgeErrorResponse("Unexpected failure"),
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "userId ASC",
	},
});

function edgeErrorResponse(description: string, retryAfter = false) {
	return {
		description,
		headers: {
			"X-Request-ID": RequestIdHeader,
			...(retryAfter ? { "Retry-After": RetryAfterHeader } : {}),
		},
		content: { "application/json": { schema: ErrorEnvelopeSchema } },
	};
}

export type AppOptions = {
	rateLimiter: RateLimiter;
	authenticationRateLimiter?: RateLimiter;
	config?: Config;
	readiness?: () => boolean | Promise<boolean>;
	verifyUserToken?: VerifyUserToken;
	clientIp?: ClientIp;
	fetch?: Fetch;
};

export function createApp(options: AppOptions) {
	const config = options.config ?? loadConfig();
	const verifyUserToken =
		options.verifyUserToken ??
		createJwtVerifier({
			jwksUrl: config.userServiceJwksUrl,
			issuer: config.userTokenIssuer,
			audience: config.userTokenAudience,
			cacheMaxAge: config.jwksCacheMs,
			cooldownDuration: config.jwksCooldownMs,
			timeoutDuration: config.jwksTimeoutMs,
		});
	const limiter = options.rateLimiter;
	const authenticationLimiter = options.authenticationRateLimiter ?? limiter;
	const clientIp = options.clientIp ?? createClientIp(config.trustedProxyIps);
	const readiness = options.readiness ?? (() => true);

	const app = new OpenAPIHono<GatewayEnv>({
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

	app.use("*", requestIdMiddleware);
	app.get("/internal/live", (c) =>
		c.json(HealthSchema.parse({ service: SERVICE, status: "ok" })),
	);
	app.get("/internal/ready", async (c) => {
		if (await readiness()) {
			return c.json(
				HealthSchema.parse({ service: SERVICE, status: "ready" }),
				200,
			);
		}
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

	const authenticate = userAuthMiddleware(verifyUserToken, (context) =>
		enforceRateLimit(
			context,
			authenticationLimiter,
			clientIp,
			"authentication-attempt",
		),
	);
	const rateLimit = rateLimitMiddleware(limiter, clientIp);
	app.use("/core/v1/session", authenticate);
	app.use("/core/v1/session", rateLimit);
	app.openapi(sessionRoute, (c) => {
		const actor = c.get("actor");
		if (!actor) {
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		}
		return c.json({ actor }, 200);
	});
	app.use(
		"/core/v1/event-roots/:rootEventId/member-directory",
		async (c, next) => {
			c.header("Cache-Control", "private, no-store");
			await next();
		},
	);
	app.use("/core/v1/event-roots/:rootEventId/member-directory", authenticate);
	app.use("/core/v1/event-roots/:rootEventId/member-directory", rateLimit);
	app.openapi(memberDirectoryRoute, (c) => {
		const query = c.req.valid("query");
		return memberDirectoryRequest(
			c,
			{
				rootEventId: c.req.valid("param").rootEventId,
				limit: query.limit,
				...(query.cursor ? { cursor: query.cursor } : {}),
			},
			config,
			options.fetch ?? fetch,
		) as never;
	});
	app.use("/core/v1/recap-share-links/resolve", async (c, next) => {
		c.header("Cache-Control", "private, no-store");
		await next();
	});
	app.use("/core/v1/recap-external-share-links/resolve", async (c, next) => {
		c.header("Cache-Control", "private, no-store");
		await next();
	});
	app.use("/core/v1/*", async (c, next) => {
		const route = findProxyRoute(c.req.method, c.req.path);
		if (route?.auth === "user") return authenticate(c, next);
		return next();
	});
	app.use("/core/v1/*", async (c, next) => {
		if (!findProxyRoute(c.req.method, c.req.path)) return next();
		return rateLimit(c, next);
	});
	app.all("/core/v1/*", async (c) => {
		const route = findProxyRoute(c.req.method, c.req.path);
		if (!route) return c.notFound();
		return proxyRequest(c, route, config, clientIp(c), options.fetch ?? fetch);
	});

	app.openAPIRegistry.registerComponent("securitySchemes", "userBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description: "Short-lived RS256 access token issued by user-service",
	});
	const document = gatewayContract(
		app.getOpenAPI31Document({
			openapi: "3.1.0",
			info: { title: "Crew API Gateway", version: "0.2.0" },
		}),
	);
	app.get("/docs/openapi.json", (c) => c.json(document));
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
		console.error("Unhandled request error", {
			requestId: c.get("requestId"),
			code: "INTERNAL_ERROR",
		});
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
