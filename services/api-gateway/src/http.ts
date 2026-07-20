import { z } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_IDENTIFIER =
	/^(?:cin_|crs_|rt_|at_|access[_-]|refresh[_-]|bearer[_-]|eyJ)/i;

export type GatewayVariables = {
	requestId: string;
	actor?: { id: string };
	userAuthorization?: string;
};

export type GatewayEnv = { Variables: GatewayVariables };

export function isSensitiveIdentifier(value: string): boolean {
	return SENSITIVE_IDENTIFIER.test(value);
}

export const ErrorDetailSchema = z
	.object({
		code: z.string(),
		path: z.string().optional(),
		message: z.string(),
		meta: z
			.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
			.optional(),
	})
	.strict()
	.openapi("ErrorDetail");

export const ErrorEnvelopeSchema = z
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

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export class ServiceError extends Error {
	constructor(
		readonly status: ContentfulStatusCode,
		readonly code: string,
		message: string,
		readonly retryable = false,
		readonly details?: ErrorDetail[],
		readonly headers: Readonly<Record<string, string>> = {},
	) {
		super(message);
	}
}

export function errorBody(
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

export const requestIdMiddleware = createMiddleware<GatewayEnv>(
	async (c, next) => {
		const incoming = c.req.header("x-request-id");
		const requestId =
			incoming && REQUEST_ID.test(incoming) && !isSensitiveIdentifier(incoming)
				? incoming
				: crypto.randomUUID();
		c.set("requestId", requestId);
		c.header("X-Request-ID", requestId);
		await next();
	},
);

export const RequestIdHeader = {
	description: "Crew request correlation identifier",
	schema: { type: "string" as const },
};
