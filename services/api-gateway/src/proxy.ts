import type { Context } from "hono";
import type { Config } from "./config";
import {
	type ProxyRoute,
	parameterValidator,
	requestBodyContract,
	responseContract,
} from "./contracts";
import type { GatewayEnv } from "./http";
import { isSensitiveIdentifier, ServiceError } from "./http";

export type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const MAX_RESPONSE_BYTES = 1_048_576;
const REPLAYED = /^(?:true|false)$/;
const RETRY_AFTER = /^\d{1,10}$/;
const SAFE_CACHE_CONTROL = new Set([
	"private, no-store",
	"no-store",
	"no-cache",
]);
const RECAP_SHARE_RESOLVE_OPERATIONS = new Set([
	"eventRecapShareLinksResolve",
	"eventRecapExternalShareLinksResolve",
]);

function isRecapShareResolveOperation(operationId: string) {
	return RECAP_SHARE_RESOLVE_OPERATIONS.has(operationId);
}

export async function proxyRequest(
	context: Context<GatewayEnv>,
	route: ProxyRoute,
	config: Config,
	clientIp: string,
	fetcher: Fetch = fetch,
): Promise<Response> {
	const requestId = context.get("requestId");
	const baseUrl = new URL(
		route.service === "user-service"
			? config.userServiceUrl
			: config.eventServiceUrl,
	);
	const incoming = new URL(context.req.url);
	const downstreamUrl = new URL(
		`${incoming.pathname.slice("/core".length)}${incoming.search}`,
		baseUrl,
	);
	if (downstreamUrl.origin !== baseUrl.origin) throw upstreamError();

	const incomingBody = await readRequestBody(
		context.req.raw,
		route.maxRequestBytes,
	);
	const incomingIdempotencyKey = context.req.header("idempotency-key");
	if (incomingIdempotencyKey && isSensitiveIdentifier(incomingIdempotencyKey)) {
		if (isRecapShareResolveOperation(route.operationId)) {
			throw concealedRecapShareNotFound();
		}
		throw validationError();
	}
	try {
		validateRequestParameters(route, incoming, context.req.raw.headers);
		validateRequestBody(
			route,
			incomingBody,
			context.req.header("content-type"),
		);
	} catch (error) {
		if (
			isRecapShareResolveOperation(route.operationId) &&
			error instanceof ServiceError &&
			error.status === 400
		) {
			throw concealedRecapShareNotFound();
		}
		throw error;
	}
	const body = incomingBody?.byteLength ? incomingBody : undefined;
	const headers = new Headers({
		Accept: "application/json",
		"X-Request-ID": requestId,
	});
	if (route.service === "user-service" && route.auth === "public") {
		headers.set("X-Forwarded-For", clientIp);
	}
	if (route.auth === "user") {
		const authorization = context.get("userAuthorization");
		if (!authorization) {
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		}
		headers.set("Authorization", authorization);
	}
	const idempotencyKey = context.req.header("idempotency-key");
	if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
	if (body !== undefined) {
		headers.set(
			"Content-Type",
			context.req.header("content-type") ?? "application/json",
		);
	}

	const controller = new AbortController();
	let timedOut = false;
	let rejectDeadline: ((reason?: unknown) => void) | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		rejectDeadline = reject;
	});
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
		rejectDeadline?.(new DOMException("Timed out", "TimeoutError"));
	}, config.downstreamTimeoutMs);
	const abort = () => controller.abort(context.req.raw.signal.reason);
	if (context.req.raw.signal.aborted) abort();
	else context.req.raw.signal.addEventListener("abort", abort, { once: true });

	let receivedHeaders = false;
	try {
		const response = await Promise.race([
			fetcher(downstreamUrl, {
				method: route.method,
				headers,
				redirect: "manual",
				signal: controller.signal,
				...(body === undefined ? {} : { body }),
			}),
			deadline,
		]);
		receivedHeaders = true;
		const responseBody = await readBody(
			response.body,
			MAX_RESPONSE_BYTES,
			controller.signal,
		);
		if (response.headers.get("X-Request-ID") !== requestId)
			throw upstreamError();
		const contract = responseContract(route, response.status);
		if (!contract) throw upstreamError();

		if (contract.kind === "empty") {
			if (responseBody.byteLength !== 0) throw upstreamError();
		} else {
			if (!isJsonMediaType(response.headers.get("Content-Type"))) {
				throw upstreamError();
			}
			let value: unknown;
			try {
				value = JSON.parse(new TextDecoder().decode(responseBody));
			} catch {
				throw upstreamError();
			}
			if (
				!contract.validate(value) ||
				(response.ok && !isSafeRouteResponse(route, value))
			) {
				throw upstreamError();
			}
			if (!response.ok && requestIdFromError(value) !== requestId) {
				throw upstreamError();
			}
		}

		const outgoing = new Headers({ "X-Request-ID": requestId });
		if (contract.kind === "json")
			outgoing.set("Content-Type", "application/json");
		copySafeHeaders(response.headers, outgoing, baseUrl);
		return new Response(contract.kind === "empty" ? null : responseBody, {
			status: response.status,
			headers: outgoing,
		});
	} catch (error) {
		if (timedOut) throw timeoutError();
		if (error instanceof ServiceError) throw error;
		throw receivedHeaders ? upstreamError() : unavailableError();
	} finally {
		clearTimeout(timeout);
		context.req.raw.signal.removeEventListener("abort", abort);
	}
}

function validateRequestParameters(
	route: ProxyRoute,
	url: URL,
	headers: Headers,
): void {
	const errors: Array<{
		instancePath: string;
		keyword: string;
		message?: string;
	}> = [];
	const queryNames = new Set(
		route.parameters
			.filter((parameter) => parameter.in === "query")
			.map((parameter) => parameter.name),
	);
	for (const name of url.searchParams.keys()) {
		if (!queryNames.has(name)) {
			errors.push({
				instancePath: `/query/${pointer(name)}`,
				keyword: "additionalProperties",
				message: "Unknown query parameter.",
			});
		}
	}

	const template = route.publicPath.split("/");
	const actual = url.pathname.split("/");
	for (const parameter of route.parameters) {
		let values: unknown[];
		if (parameter.in === "header") {
			const value = headers.get(parameter.name);
			values = value === null ? [] : [value];
		} else if (parameter.in === "query") {
			values = url.searchParams.getAll(parameter.name);
		} else {
			const index = template.indexOf(`{${parameter.name}}`);
			try {
				values =
					index < 0 || actual[index] === undefined
						? []
						: [decodeURIComponent(actual[index])];
			} catch {
				values = [];
				errors.push({
					instancePath: `/path/${pointer(parameter.name)}`,
					keyword: "encoding",
					message: "Invalid path encoding.",
				});
			}
		}

		if (values.length === 0) {
			if (parameter.required) {
				errors.push({
					instancePath: `/${parameter.in}/${pointer(parameter.name)}`,
					keyword: "required",
					message: "Required parameter is missing.",
				});
			}
			continue;
		}
		const validate = parameterValidator(route, parameter);
		const candidates = parameter.schema.type === "array" ? [values] : values;
		for (const value of candidates) {
			if (validate(value)) continue;
			for (const error of validate.errors ?? []) {
				errors.push({
					instancePath: `/${parameter.in}/${pointer(parameter.name)}${error.instancePath}`,
					keyword: error.keyword,
					...(error.message ? { message: error.message } : {}),
				});
			}
		}
	}
	if (errors.length > 0) throw validationError(errors);
}

function validateRequestBody(
	route: ProxyRoute,
	body: ArrayBuffer | undefined,
	contentType: string | undefined,
): void {
	if (!body?.byteLength) {
		if (route.requestBodyRequired) throw validationError();
		return;
	}
	if (!route.hasRequestBody) throw validationError();
	if (!isJsonMediaType(contentType)) {
		throw new ServiceError(
			415,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json.",
			false,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(body));
	} catch {
		throw validationError();
	}
	const validate = requestBodyContract(route);
	if (validate && !validate(value)) throw validationError(validate.errors);
}

async function readRequestBody(
	request: Request,
	maxBytes: number,
): Promise<ArrayBuffer | undefined> {
	const declared = request.headers.get("Content-Length");
	if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
		throw payloadTooLarge();
	}
	if (!request.body) return;
	return readBody(request.body, maxBytes).catch(() => {
		throw payloadTooLarge();
	});
}

async function readBody(
	body: ReadableStream<Uint8Array> | null,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<ArrayBuffer> {
	if (!body) return new ArrayBuffer(0);
	const reader = body.getReader();
	let rejectAbort: ((reason?: unknown) => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = () => {
		rejectAbort?.(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		cancelReader(reader, signal?.reason);
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
			if (size > maxBytes) {
				cancelReader(reader);
				throw new Error("Body too large");
			}
			chunks.push(value);
		}
	} finally {
		signal?.removeEventListener("abort", abort);
		try {
			reader.releaseLock();
		} catch {
			// A broken stream may retain a pending read; cancellation above is best effort.
		}
	}
	const resultBuffer = new ArrayBuffer(size);
	const result = new Uint8Array(resultBuffer);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return resultBuffer;
}

function cancelReader(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	reason?: unknown,
): void {
	try {
		void reader.cancel(reason).catch(() => undefined);
	} catch {
		// Cancellation is advisory; the gateway response must not wait for it.
	}
}

function isJsonMediaType(value: string | null | undefined): boolean {
	return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function pointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function copySafeHeaders(
	upstream: Headers,
	outgoing: Headers,
	baseUrl: URL,
): void {
	const location = upstream.get("Location");
	if (location) outgoing.set("Location", publicLocation(location, baseUrl));
	const replayed = upstream.get("Idempotency-Replayed");
	if (replayed && REPLAYED.test(replayed)) {
		outgoing.set("Idempotency-Replayed", replayed);
	}
	const retryAfter = upstream.get("Retry-After");
	if (retryAfter && RETRY_AFTER.test(retryAfter)) {
		outgoing.set("Retry-After", retryAfter);
	}
	const cacheControl = upstream.get("Cache-Control");
	if (cacheControl && SAFE_CACHE_CONTROL.has(cacheControl.toLowerCase())) {
		outgoing.set("Cache-Control", cacheControl);
	}
}

function publicLocation(location: string, baseUrl: URL): string {
	let resolved: URL;
	try {
		resolved = new URL(location, baseUrl);
	} catch {
		throw upstreamError();
	}
	if (
		resolved.origin !== baseUrl.origin ||
		!resolved.pathname.startsWith("/v1/")
	) {
		throw upstreamError();
	}
	return `/core${resolved.pathname}${resolved.search}${resolved.hash}`;
}

function requestIdFromError(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || !("error" in value)) return;
	const error = value.error;
	if (!error || typeof error !== "object" || !("requestId" in error)) return;
	return typeof error.requestId === "string" ? error.requestId : undefined;
}

function isSafeRouteResponse(route: ProxyRoute, value: unknown): boolean {
	if (!isRecapShareResolveOperation(route.operationId)) return true;
	if (!isRecord(value) || !isRecord(value.recap)) return false;
	const items = value.recap.items;
	return (
		Array.isArray(items) &&
		items.every((item, index) => isRecord(item) && item.ordinal === index)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadTooLarge(): ServiceError {
	return new ServiceError(
		413,
		"PAYLOAD_TOO_LARGE",
		"The request body is too large.",
		false,
	);
}

function validationError(
	errors?: null | ReadonlyArray<{
		instancePath: string;
		keyword: string;
		message?: string;
	}>,
): ServiceError {
	return new ServiceError(
		400,
		"VALIDATION_FAILED",
		"The request is invalid.",
		false,
		errors?.slice(0, 20).map((error) => ({
			code: error.keyword.toUpperCase(),
			message: error.message ?? "Invalid value.",
			...(error.instancePath ? { path: error.instancePath } : {}),
		})),
	);
}

function concealedRecapShareNotFound(): ServiceError {
	return new ServiceError(404, "NOT_FOUND", "Resource not found.");
}

function upstreamError(): ServiceError {
	return new ServiceError(
		502,
		"UPSTREAM_ERROR",
		"A required service returned an invalid response.",
		true,
	);
}

function timeoutError(): ServiceError {
	return new ServiceError(
		504,
		"UPSTREAM_TIMEOUT",
		"A required service timed out.",
		true,
	);
}

function unavailableError(): ServiceError {
	return new ServiceError(
		503,
		"SERVICE_UNAVAILABLE",
		"A required service is unavailable.",
		true,
	);
}
