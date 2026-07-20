import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { SignJWT } from "jose";
import type { Config } from "./config";
import {
	findComposeRoute,
	type ProxyRoute,
	requestBodyContract,
	responseContract,
} from "./contracts";
import type { GatewayEnv } from "./http";
import { ServiceError } from "./http";
import type { Fetch } from "./proxy";

const MAX_RESPONSE_BYTES = 1_048_576;
const eventSourceRoute = findComposeRoute("eventMemberDirectorySourceGet");
const userResolveRoute = findComposeRoute(
	"usersMemberDirectoryProfilesResolve",
);

type DirectoryQuery = {
	rootEventId: string;
	limit: number;
	cursor?: string;
};

type EventSource = {
	schemaVersion: 1;
	rootEventId: string;
	userIds: string[];
	pageInfo: { nextCursor: string | null; hasMore: boolean };
};

type UserProfiles = {
	schemaVersion: 1;
	rootEventId: string;
	profiles: Array<{
		userId: string;
		displayName: string | null;
		profileVersion: number;
	}>;
};

export async function memberDirectoryRequest(
	context: Context<GatewayEnv>,
	query: DirectoryQuery,
	config: Config,
	fetcher: Fetch = fetch,
): Promise<Response> {
	const requestId = context.get("requestId");
	const authorization = context.get("userAuthorization");
	if (!authorization) {
		throw new ServiceError(
			401,
			"UNAUTHENTICATED",
			"Authentication is required.",
		);
	}

	const controller = new AbortController();
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException("Timed out", "TimeoutError"));
	}, config.downstreamTimeoutMs);
	const abort = () => controller.abort(context.req.raw.signal.reason);
	if (context.req.raw.signal.aborted) abort();
	else context.req.raw.signal.addEventListener("abort", abort, { once: true });

	try {
		const eventUrl = new URL(
			`/v1/event-roots/${encodeURIComponent(query.rootEventId)}/member-directory-source`,
			config.eventServiceUrl,
		);
		eventUrl.searchParams.set("limit", String(query.limit));
		if (query.cursor) eventUrl.searchParams.set("cursor", query.cursor);
		const eventResult = await pinnedJson(
			eventSourceRoute,
			eventUrl,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: authorization,
					"X-Request-ID": requestId,
				},
				signal: controller.signal,
			},
			requestId,
			fetcher,
		);
		if (!eventResult.response.ok) throw downstreamServiceError(eventResult);
		const source = eventResult.value as EventSource;
		if (
			source.schemaVersion !== 1 ||
			source.rootEventId !== query.rootEventId ||
			new Set(source.userIds).size !== source.userIds.length
		) {
			throw upstreamError();
		}

		if (source.userIds.length === 0) {
			return directoryResponse([], source.pageInfo, requestId);
		}

		const resolveBody = {
			schemaVersion: 1 as const,
			rootEventId: query.rootEventId,
			userIds: source.userIds,
		};
		const validateRequest = requestBodyContract(userResolveRoute);
		if (!validateRequest?.(resolveBody)) throw upstreamError();
		const userResult = await pinnedJson(
			userResolveRoute,
			new URL("/v1/member-directory-profiles/resolve", config.userServiceUrl),
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${await issueServiceToken(config)}`,
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify(resolveBody),
				signal: controller.signal,
			},
			requestId,
			fetcher,
		);
		if (!userResult.response.ok) throw upstreamError();
		const resolved = userResult.value as UserProfiles;
		if (
			resolved.schemaVersion !== 1 ||
			resolved.rootEventId !== query.rootEventId ||
			resolved.profiles.length !== source.userIds.length ||
			resolved.profiles.some(
				(profile, index) => profile.userId !== source.userIds[index],
			)
		) {
			throw upstreamError();
		}

		return directoryResponse(
			resolved.profiles.map(({ userId, displayName }) => ({
				userId,
				displayName,
			})),
			source.pageInfo,
			requestId,
		);
	} catch (error) {
		if (timedOut) throw timeoutError();
		throw error;
	} finally {
		clearTimeout(timeout);
		context.req.raw.signal.removeEventListener("abort", abort);
	}
}

async function pinnedJson(
	route: ProxyRoute,
	url: URL,
	init: RequestInit,
	requestId: string,
	fetcher: Fetch,
) {
	let response: Response;
	try {
		response = await fetcher(url, { ...init, redirect: "manual" });
	} catch (error) {
		if (init.signal?.aborted) throw error;
		throw unavailableError();
	}

	try {
		if (response.headers.get("X-Request-ID") !== requestId) {
			throw upstreamError();
		}
		if (!isJson(response.headers.get("Content-Type"))) throw upstreamError();
		const bytes = await readBody(
			response.body,
			MAX_RESPONSE_BYTES,
			init.signal,
		);
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw upstreamError();
		}
		const contract = responseContract(route, response.status);
		if (contract?.kind !== "json" || !contract.validate(value)) {
			throw upstreamError();
		}
		if (!response.ok && requestIdFromError(value) !== requestId) {
			throw upstreamError();
		}
		return { response, value };
	} catch (error) {
		if (init.signal?.aborted) throw error;
		if (error instanceof ServiceError) throw error;
		throw upstreamError();
	}
}

function downstreamServiceError(result: {
	response: Response;
	value: unknown;
}) {
	const value = result.value as {
		error: {
			code: string;
			message: string;
			retryable: boolean;
			details?: Array<{ code: string; message: string; path?: string }>;
		};
	};
	return new ServiceError(
		result.response.status as ContentfulStatusCode,
		value.error.code,
		value.error.message,
		value.error.retryable,
		value.error.details,
	);
}

async function issueServiceToken(config: Config) {
	const key = new Uint8Array(
		Buffer.from(config.memberDirectoryServiceCurrentKey, "base64url"),
	);
	return new SignJWT({ scope: "user:member-directory:read" })
		.setProtectedHeader({
			alg: "HS256",
			kid: config.memberDirectoryServiceCurrentKeyId,
			typ: "JWT",
		})
		.setIssuer(config.memberDirectoryServiceIssuer)
		.setAudience(config.memberDirectoryServiceAudience)
		.setSubject("api-gateway")
		.setIssuedAt()
		.setExpirationTime("5m")
		.setJti(randomUUID())
		.sign(key);
}

function directoryResponse(
	items: Array<{ userId: string; displayName: string | null }>,
	pageInfo: EventSource["pageInfo"],
	requestId: string,
) {
	return Response.json(
		{ items, pageInfo },
		{
			status: 200,
			headers: {
				"Cache-Control": "private, no-store",
				"X-Request-ID": requestId,
			},
		},
	);
}

async function readBody(
	body: ReadableStream<Uint8Array> | null,
	maxBytes: number,
	signal?: AbortSignal | null,
) {
	if (!body) return new ArrayBuffer(0);
	const reader = body.getReader();
	let rejectAbort: ((reason?: unknown) => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = () => {
		rejectAbort?.(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		try {
			void reader.cancel(signal?.reason).catch(() => undefined);
		} catch {
			// Cancellation is best effort; the deadline still rejects the read.
		}
	};
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = signal
				? await Promise.race([reader.read(), aborted])
				: await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw upstreamError();
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		try {
			reader.releaseLock();
		} catch {
			// A broken stream can retain a pending read after cancellation.
		}
	}
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output.buffer;
}

function isJson(value: string | null) {
	return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function requestIdFromError(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || !("error" in value)) return;
	const error = value.error;
	if (!error || typeof error !== "object" || !("requestId" in error)) return;
	return typeof error.requestId === "string" ? error.requestId : undefined;
}

function upstreamError() {
	return new ServiceError(
		502,
		"UPSTREAM_ERROR",
		"A required service returned an invalid response.",
		true,
	);
}

function timeoutError() {
	return new ServiceError(
		504,
		"UPSTREAM_TIMEOUT",
		"A required service timed out.",
		true,
	);
}

function unavailableError() {
	return new ServiceError(
		503,
		"SERVICE_UNAVAILABLE",
		"A required service is unavailable.",
		true,
	);
}
