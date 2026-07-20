import type { components, operations } from "./generated/gateway.ts";
import {
	type GatewayJsonSchema,
	type GatewayOperationId,
	type GatewayRoute,
	type GatewaySuccessResponse,
	gatewayRoutes,
	gatewaySchemas,
} from "./generated/routes.ts";

export type Session = components["schemas"]["UserServiceSession"];
export type OperationId = GatewayOperationId & keyof operations;
const gatewayRemoteErrorCodeValues = [
	"ATTACHMENT_CAPTION_INVALID",
	"ATTACHMENT_CHECKSUM_MISMATCH",
	"ATTACHMENT_COMMIT_MISMATCH",
	"ATTACHMENT_DECODE_FAILED",
	"ATTACHMENT_ID_MISMATCH",
	"ATTACHMENT_IMAGE_LIMIT_EXCEEDED",
	"ATTACHMENT_LIMIT_REACHED",
	"ATTACHMENT_SIZE_MISMATCH",
	"ATTACHMENT_STORE_UNAVAILABLE",
	"ATTACHMENT_TOO_LARGE",
	"ATTACHMENT_TYPE_MISMATCH",
	"ATTACHMENT_VERIFICATION_CAPACITY",
	"ATTACHMENT_VERIFICATION_DEAD",
	"ATTACHMENT_VERIFICATION_PENDING",
	"ATTACHMENT_VERIFICATION_REJECTED",
	"AUTHORITATIVE_ORDER",
	"BOOTSTRAP_REQUIRED",
	"CAPABILITY_DEPENDENCIES_EXIST",
	"CAPABILITY_TYPE_MISMATCH",
	"CAUSAL_GAP",
	"COLLECTION_LIMIT_REACHED",
	"CURRENT_VERSION",
	"CURSOR_EXPIRED",
	"CURSOR_INVALID",
	"DEPENDENCY_EXISTS",
	"DETAILS_REFERENCE_INVALID",
	"DETAILS_SCHEMA_INVALID",
	"DEVICE_FANOUT_LIMIT_EXCEEDED",
	"ENTITY_DELETED",
	"EVENT_TEMPLATE_ADOPTION_STATE_INVALID",
	"EVENT_TEMPLATE_ALREADY_SET",
	"EVENT_TEMPLATE_CONTENT_COLLISION",
	"EVENT_TEMPLATE_IDS_INVALID",
	"EVENT_TEMPLATE_INVALID",
	"EVENT_TEMPLATE_ROOT_ID_MISMATCH",
	"EVENT_TEMPLATE_ROOT_KIND_MISMATCH",
	"EVENT_TEMPLATE_VERSION_CONFLICT",
	"EXPIRY_TOO_FAR",
	"FEED_BODY_INVALID",
	"FEED_NOTIFICATION_RECIPIENT_LIMIT_REACHED",
	"FEED_PARENT_CONTEXT_INVALID",
	"FEED_PARENT_INVALID",
	"FEED_PARENT_REQUIRED",
	"FORBIDDEN",
	"HIERARCHY_CYCLE",
	"IDEMPOTENCY_IN_PROGRESS",
	"IDEMPOTENCY_KEY_REUSED",
	"ID_COLLISION",
	"INTERNAL_ERROR",
	"INVALID_COORDINATES",
	"INVALID_COUNTRY_CODE",
	"INVALID_ORDER",
	"INVALID_ROOT_STATUS",
	"INVALID_TIME_RANGE",
	"INVALID_TIME_ZONE",
	"INVITATION_EMAIL_INVALID",
	"INVITATION_EMAIL_MISMATCH",
	"INVITATION_INVALID",
	"INVITATION_UNAVAILABLE",
	"LIVE_DEPENDENCIES",
	"LIVE_DESCENDANTS",
	"MAGIC_LINK_INVALID",
	"NOT_FOUND",
	"OWNER_TRANSFER_REQUIRED",
	"PAGINATION_INVALID",
	"PAYLOAD_TOO_LARGE",
	"PLACE_CANDIDATE_NOT_FOUND",
	"PLACE_ENRICHMENT_INPUT_INVALID",
	"PLACE_ENRICHMENT_NOT_FOUND",
	"PLACE_ENRICHMENT_RETRY_UNAVAILABLE",
	"PLACE_INVALID",
	"PREVIOUS_MUTATION_BLOCKED",
	"RATE_LIMITED",
	"REACTION_INVALID",
	"ROOT_ARCHIVED",
	"ROOT_DELETE_FORBIDDEN",
	"ROOT_GRAPH_LIMIT_EXCEEDED",
	"ROOT_REPARENT_FORBIDDEN",
	"ROOT_REVISION_CONFLICT",
	"SEQUENCE_REUSED",
	"SERVICE_UNAVAILABLE",
	"SESSION_REVOKED",
	"SYNC_ENTITY_ID_MISMATCH",
	"SYNC_PAYLOAD_INVALID",
	"UNAUTHENTICATED",
	"UNSUPPORTED_MEDIA_TYPE",
	"UPLOAD_EXPIRED",
	"UPLOAD_LIMIT_REACHED",
	"UPSTREAM_ERROR",
	"UPSTREAM_TIMEOUT",
	"VALIDATION_FAILED",
	"VERSION_CONFLICT",
] as const;
export type GatewayRemoteErrorCode =
	(typeof gatewayRemoteErrorCodeValues)[number];
const gatewayRemoteErrorCodes: ReadonlySet<string> = new Set(
	gatewayRemoteErrorCodeValues,
);
export type GatewayErrorCode =
	| GatewayRemoteErrorCode
	| "aborted"
	| "http_error"
	| "invalid_request"
	| "invalid_response"
	| "network_error"
	| "refresh_failed"
	| "request_failed"
	| "session_changed"
	| "session_store_error"
	| "timeout"
	| "unauthenticated";

type Operation<Id extends OperationId> = operations[Id];
type EmptyRecord = Record<never, never>;
type OperationParameters<Id extends OperationId> =
	Operation<Id> extends {
		parameters: infer Parameters;
	}
		? Parameters
		: never;
type ParameterValue<
	Id extends OperationId,
	Kind extends "header" | "path" | "query",
> = Kind extends keyof OperationParameters<Id>
	? Exclude<OperationParameters<Id>[Kind], undefined>
	: never;
type ParameterField<
	Id extends OperationId,
	Kind extends "path" | "query",
> = Kind extends keyof OperationParameters<Id>
	? [ParameterValue<Id, Kind>] extends [never]
		? { [Key in Kind]?: never }
		: EmptyRecord extends Pick<OperationParameters<Id>, Kind>
			? { [Key in Kind]?: ParameterValue<Id, Kind> }
			: { [Key in Kind]: ParameterValue<Id, Kind> }
	: { [Key in Kind]?: never };
type HeaderField<Id extends OperationId> = [
	ParameterValue<Id, "header">,
] extends [never]
	? { headers?: never }
	: { headers?: Partial<ParameterValue<Id, "header">> };
type RequestBodyContainer<Id extends OperationId> =
	Operation<Id> extends {
		requestBody?: infer Body;
	}
		? Exclude<Body, undefined>
		: never;
type JsonBody<Id extends OperationId> =
	RequestBodyContainer<Id> extends {
		content: { "application/json": infer Body };
	}
		? Body
		: never;
type BodyField<Id extends OperationId> = [JsonBody<Id>] extends [never]
	? { body?: never }
	: Operation<Id> extends { requestBody: unknown }
		? { body: JsonBody<Id> }
		: { body?: JsonBody<Id> };
type Responses<Id extends OperationId> =
	Operation<Id> extends {
		responses: infer ResponseMap;
	}
		? ResponseMap
		: never;
type SuccessKey<ResponseMap> = keyof ResponseMap extends infer Key
	? Key extends string | number
		? `${Key}` extends `2${string}`
			? Key
			: never
		: never
	: never;
type JsonResponse<Response> = Response extends {
	content: { "application/json": infer Data };
}
	? Data
	: undefined;

export type GatewayResponseData<Id extends OperationId> = JsonResponse<
	Responses<Id>[SuccessKey<Responses<Id>>]
>;

export type GatewayRequest<Id extends OperationId> = ParameterField<
	Id,
	"path"
> &
	ParameterField<Id, "query"> &
	HeaderField<Id> &
	BodyField<Id> & {
		signal?: AbortSignal;
		timeoutMs?: number;
	};

export interface SessionStore {
	get(): Promise<Session | null>;
	compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean>;
}

export interface GatewayResponse<Data> {
	data: Data;
	status: number;
	requestId: string;
}

declare const gatewaySessionSubjectBrand: unique symbol;

export interface GatewaySessionSubject {
	readonly userId: string;
	readonly [gatewaySessionSubjectBrand]: true;
}

interface SessionFingerprint {
	readonly userId: string;
	readonly accessToken: string;
	readonly refreshToken: string;
}

export interface GatewayDiagnostic {
	type: "request_failed";
	operationId: OperationId;
	status: number | null;
	requestId: string;
	code: GatewayErrorCode;
	retryable: boolean;
	retryAfterSeconds: number | null;
}

export interface GatewayClientOptions {
	baseUrl: string;
	sessionStore: SessionStore;
	fetch?: typeof fetch;
	timeoutMs?: number;
	requestId?: () => string;
	idempotencyKey?: () => string;
	onDiagnostic?: (diagnostic: GatewayDiagnostic) => void;
}

export class GatewayClientError extends Error {
	readonly operationId: OperationId;
	readonly status: number | null;
	readonly requestId: string;
	readonly code: GatewayErrorCode;
	readonly retryable: boolean;
	readonly retryAfterSeconds: number | null;

	constructor(diagnostic: Omit<GatewayDiagnostic, "type">) {
		super("Gateway request failed");
		this.name = "GatewayClientError";
		this.operationId = diagnostic.operationId;
		this.status = diagnostic.status;
		this.requestId = diagnostic.requestId;
		this.code = diagnostic.code;
		this.retryable = diagnostic.retryable;
		this.retryAfterSeconds = diagnostic.retryAfterSeconds;
	}

	toJSON(): Omit<GatewayDiagnostic, "type"> & { name: string } {
		return {
			name: this.name,
			operationId: this.operationId,
			status: this.status,
			requestId: this.requestId,
			code: this.code,
			retryable: this.retryable,
			retryAfterSeconds: this.retryAfterSeconds,
		};
	}
}

interface RuntimeRequest {
	path?: Record<string, unknown>;
	query?: Record<string, unknown>;
	headers?: Record<string, unknown>;
	body?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
}

interface AttemptResult {
	status: number;
	requestId: string;
	contentType: string | null;
	body: unknown;
	invalidJson: boolean;
	retryAfterSeconds: number | null;
}

const aborted = Symbol("request-aborted");
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const internalErrorCodes = new Set<GatewayErrorCode>([
	"aborted",
	"http_error",
	"invalid_request",
	"invalid_response",
	"network_error",
	"refresh_failed",
	"request_failed",
	"session_changed",
	"session_store_error",
	"timeout",
	"unauthenticated",
]);

export class GatewayClient {
	readonly #baseUrl: string;
	readonly #sessionStore: SessionStore;
	readonly #fetch: typeof fetch;
	readonly #timeoutMs: number;
	readonly #requestId: () => string;
	readonly #idempotencyKey: () => string;
	readonly #onDiagnostic: ((diagnostic: GatewayDiagnostic) => void) | undefined;
	#refreshFlight: {
		rejected: SessionFingerprint;
		subjectBound: boolean;
		promise: Promise<Session>;
	} | null = null;
	#invalidatedAccessToken: string | null = null;
	readonly #sessionSubjects = new WeakMap<
		GatewaySessionSubject,
		SessionFingerprint
	>();

	constructor(options: GatewayClientOptions) {
		const baseUrl = new URL(options.baseUrl);
		if (
			baseUrl.protocol !== "https:" &&
			!(baseUrl.protocol === "http:" && isLoopbackHost(baseUrl.hostname))
		) {
			throw new TypeError(
				"Gateway base URL must use HTTPS (HTTP is limited to localhost, 127.0.0.1, or [::1])",
			);
		}
		this.#baseUrl = baseUrl.toString().replace(/\/$/, "");
		this.#sessionStore = options.sessionStore;
		this.#fetch = options.fetch ?? fetch;
		this.#timeoutMs = positiveTimeout(options.timeoutMs ?? 15_000);
		this.#requestId = options.requestId ?? randomIdentifier;
		this.#idempotencyKey = options.idempotencyKey ?? randomIdentifier;
		this.#onDiagnostic = options.onDiagnostic;
	}

	async request<Id extends OperationId>(
		operationId: Id,
		options: GatewayRequest<Id>,
	): Promise<GatewayResponse<GatewayResponseData<Id>>> {
		return this.#request(operationId, options, null);
	}

	async #request<Id extends OperationId>(
		operationId: Id,
		options: GatewayRequest<Id>,
		expectedSubject: GatewaySessionSubject | null,
	): Promise<GatewayResponse<GatewayResponseData<Id>>> {
		const route = routeFor(operationId);
		if (expectedSubject && route.auth !== "required") {
			throw new TypeError("requestAsUser requires an authenticated operation");
		}
		const expectedSession = expectedSubject
			? this.#subjectSession(expectedSubject)
			: null;
		const input = options as RuntimeRequest;
		const storedSession =
			route.auth === "required" ? await this.#readSession(operationId) : null;
		let authenticatedFingerprint = storedSession
			? sessionFingerprint(storedSession)
			: null;
		let authenticatedSession =
			storedSession && authenticatedFingerprint
				? sessionWithFingerprint(storedSession, authenticatedFingerprint)
				: null;
		if (
			expectedSession &&
			(!authenticatedFingerprint ||
				!sameSessionFingerprint(authenticatedFingerprint, expectedSession))
		) {
			throw this.#sessionChanged(operationId, newIdentifier(this.#requestId));
		}
		if (route.auth === "required" && !authenticatedSession) {
			throw this.#error(operationId, null, newIdentifier(this.#requestId), {
				code: "unauthenticated",
				retryable: false,
			});
		}

		let result = await this.#attempt(
			route,
			input,
			authenticatedSession?.accessToken,
		);
		if (
			result.status === 401 &&
			route.auth === "required" &&
			authenticatedSession &&
			authenticatedFingerprint
		) {
			const refreshedSession = await waitForCaller(
				this.#refresh(
					authenticatedSession,
					authenticatedFingerprint,
					expectedSubject !== null,
				),
				input.signal,
				() =>
					this.#error(operationId, null, result.requestId, {
						code: "aborted",
						retryable: false,
					}),
			);
			authenticatedFingerprint = sessionFingerprint(refreshedSession);
			authenticatedSession = sessionWithFingerprint(
				refreshedSession,
				authenticatedFingerprint,
			);
			result = await this.#attempt(
				route,
				input,
				authenticatedSession.accessToken,
			);
		}
		if (
			route.auth === "required" &&
			authenticatedSession &&
			authenticatedFingerprint
		) {
			await this.#assertCurrentSession(
				authenticatedFingerprint,
				operationId,
				result.requestId,
			);
			if (expectedSubject) {
				this.#sessionSubjects.set(expectedSubject, authenticatedFingerprint);
			}
			if (result.status === 401) {
				const clearResult = await this.#clearSession(authenticatedSession);
				if (clearResult === "changed") {
					throw this.#sessionChanged(operationId, result.requestId);
				}
			}
		}

		if (result.status < 200 || result.status >= 300) {
			throw this.#httpError(operationId, result);
		}
		const success = route.successResponses.find(
			(candidate) => candidate.status === result.status,
		);
		if (
			!success ||
			result.invalidJson ||
			result.contentType !== success.contentType ||
			!isSuccessData<Id>(operationId, result.body, success)
		) {
			throw this.#error(operationId, result.status, result.requestId, {
				code: "invalid_response",
				retryable: false,
			});
		}
		return {
			data: result.body,
			status: result.status,
			requestId: result.requestId,
		};
	}

	async sessionSubject(): Promise<GatewaySessionSubject | null> {
		const session = await this.#readSession("usersSessionGet");
		if (!session) return null;
		const subject = Object.freeze({
			userId: session.user.id,
		}) as GatewaySessionSubject;
		this.#sessionSubjects.set(subject, sessionFingerprint(session));
		return subject;
	}

	async assertSessionSubject(subject: GatewaySessionSubject): Promise<void> {
		await this.#assertSessionSubject(
			subject,
			"usersSessionGet",
			newIdentifier(this.#requestId),
		);
	}

	async requestAsUser<Id extends OperationId>(
		subject: GatewaySessionSubject,
		operationId: Id,
		options: GatewayRequest<Id>,
	): Promise<GatewayResponse<GatewayResponseData<Id>>> {
		return this.#request(operationId, options, subject);
	}

	async #refresh(
		rejected: Session,
		rejectedFingerprint: SessionFingerprint,
		subjectBound: boolean,
	): Promise<Session> {
		const rejectedSnapshot = sessionWithFingerprint(
			rejected,
			rejectedFingerprint,
		);
		const rejectedToken = rejectedFingerprint.accessToken;
		const userId = rejectedFingerprint.userId;
		let current: Session | null;
		try {
			const storedCurrent = await this.#readSession("identitySessionsRefresh");
			current = storedCurrent
				? sessionWithFingerprint(
						storedCurrent,
						sessionFingerprint(storedCurrent),
					)
				: null;
		} catch (error) {
			await this.#clearSession(rejectedSnapshot);
			throw error;
		}
		if (!current) {
			throw this.#error(
				"identitySessionsRefresh",
				null,
				newIdentifier(this.#requestId),
				{ code: "unauthenticated", retryable: false },
			);
		}
		if (current.user.id !== userId) {
			throw this.#error(
				"identitySessionsRefresh",
				null,
				newIdentifier(this.#requestId),
				{ code: "session_changed", retryable: false },
			);
		}
		if (
			subjectBound
				? !matchesSessionFingerprint(current, rejectedFingerprint)
				: current.accessToken !== rejectedToken
		) {
			if (
				subjectBound &&
				this.#refreshFlight?.subjectBound &&
				sameSessionFingerprint(
					this.#refreshFlight.rejected,
					rejectedFingerprint,
				)
			) {
				return this.#refreshFlight.promise;
			}
			if (subjectBound) {
				throw this.#sessionChanged(
					"identitySessionsRefresh",
					newIdentifier(this.#requestId),
				);
			}
			return current;
		}
		if (this.#refreshFlight) {
			if (
				this.#refreshFlight.rejected.accessToken === rejectedToken &&
				this.#refreshFlight.rejected.userId === userId
			) {
				if (
					subjectBound &&
					(!this.#refreshFlight.subjectBound ||
						!sameSessionFingerprint(
							this.#refreshFlight.rejected,
							rejectedFingerprint,
						))
				) {
					throw this.#sessionChanged(
						"identitySessionsRefresh",
						newIdentifier(this.#requestId),
					);
				}
				return this.#refreshFlight.promise;
			}
			throw this.#error(
				"identitySessionsRefresh",
				null,
				newIdentifier(this.#requestId),
				{ code: "session_changed", retryable: false },
			);
		}

		const flight = this.#rotate(
			rejectedSnapshot,
			rejectedFingerprint,
			subjectBound,
		);
		this.#refreshFlight = {
			rejected: rejectedFingerprint,
			subjectBound,
			promise: flight,
		};
		const clearFlight = () => {
			if (this.#refreshFlight?.promise === flight) this.#refreshFlight = null;
		};
		flight.then(clearFlight, clearFlight);
		return flight;
	}

	async #rotate(
		rejected: Session,
		rejectedFingerprint: SessionFingerprint,
		subjectBound: boolean,
	): Promise<Session> {
		const rejectedToken = rejectedFingerprint.accessToken;
		const userId = rejectedFingerprint.userId;
		try {
			const storedCurrent = await this.#readSession("identitySessionsRefresh");
			if (!storedCurrent) throw new Error("session unavailable");
			const current = sessionWithFingerprint(
				storedCurrent,
				sessionFingerprint(storedCurrent),
			);
			if (current.user.id !== userId) {
				throw this.#error(
					"identitySessionsRefresh",
					null,
					newIdentifier(this.#requestId),
					{ code: "session_changed", retryable: false },
				);
			}
			if (
				subjectBound
					? !matchesSessionFingerprint(current, rejectedFingerprint)
					: current.accessToken !== rejectedToken
			) {
				if (subjectBound) {
					throw this.#sessionChanged(
						"identitySessionsRefresh",
						newIdentifier(this.#requestId),
					);
				}
				return current;
			}
			const route = routeFor("identitySessionsRefresh");
			const result = await this.#attempt(route, {
				body: {
					refreshToken: subjectBound
						? rejectedFingerprint.refreshToken
						: current.refreshToken,
				},
			});
			if (result.status < 200 || result.status >= 300) {
				throw this.#httpError("identitySessionsRefresh", result);
			}
			const success = route.successResponses.find(
				(candidate) => candidate.status === result.status,
			);
			if (
				!success ||
				result.invalidJson ||
				result.contentType !== success.contentType ||
				!isSuccessData<"identitySessionsRefresh">(
					"identitySessionsRefresh",
					result.body,
					success,
				)
			) {
				throw this.#error(
					"identitySessionsRefresh",
					result.status,
					result.requestId,
					{ code: "invalid_response", retryable: false },
				);
			}
			if (result.body.user.id !== userId) {
				throw this.#error(
					"identitySessionsRefresh",
					result.status,
					result.requestId,
					{ code: "invalid_response", retryable: false },
				);
			}
			const rotated = sessionWithFingerprint(
				result.body,
				sessionFingerprint(result.body),
			);
			if (!(await this.#sessionStore.compareAndSet(current, result.body))) {
				if (subjectBound) {
					throw this.#sessionChanged(
						"identitySessionsRefresh",
						result.requestId,
					);
				}
				const storedLatest = await this.#readSession("identitySessionsRefresh");
				const latest = storedLatest
					? sessionWithFingerprint(
							storedLatest,
							sessionFingerprint(storedLatest),
						)
					: null;
				if (
					latest &&
					latest.user.id === userId &&
					latest.accessToken !== rejectedToken
				) {
					return latest;
				}
				throw this.#sessionChanged("identitySessionsRefresh", result.requestId);
			}
			this.#invalidatedAccessToken = null;
			return rotated;
		} catch (error) {
			if (
				error instanceof GatewayClientError &&
				error.code === "session_changed"
			) {
				throw error;
			}
			const clearResult = await this.#clearSession(rejected);
			if (clearResult === "changed") {
				throw this.#sessionChanged(
					"identitySessionsRefresh",
					newIdentifier(this.#requestId),
				);
			}
			if (error instanceof GatewayClientError) throw error;
			throw this.#error(
				"identitySessionsRefresh",
				null,
				newIdentifier(this.#requestId),
				{ code: "refresh_failed", retryable: false },
			);
		}
	}

	async #attempt(
		route: GatewayRoute & { operationId: OperationId },
		input: RuntimeRequest,
		accessToken?: string,
	): Promise<AttemptResult> {
		const requestId = newIdentifier(this.#requestId);
		const timeoutMs = positiveTimeout(input.timeoutMs ?? this.#timeoutMs);
		const controller = new AbortController();
		let timedOut = false;
		let response: Response | undefined;
		const abortFromCaller = () => controller.abort();
		if (input.signal?.aborted) controller.abort();
		else
			input.signal?.addEventListener("abort", abortFromCaller, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);

		try {
			const path = renderPath(route, input.path, () =>
				this.#error(route.operationId, null, requestId, {
					code: "invalid_request",
					retryable: false,
				}),
			);
			const url = new URL(`${this.#baseUrl}${path}`);
			appendQuery(url, route, input.query, () =>
				this.#error(route.operationId, null, requestId, {
					code: "invalid_request",
					retryable: false,
				}),
			);
			const headers = requestHeaders(
				route,
				input,
				requestId,
				accessToken,
				this.#idempotencyKey,
				() =>
					this.#error(route.operationId, null, requestId, {
						code: "invalid_request",
						retryable: false,
					}),
			);
			const body =
				input.body === undefined ? undefined : JSON.stringify(input.body);
			response = await abortable(
				this.#fetch(url, {
					method: route.method,
					headers,
					...(body === undefined ? {} : { body }),
					redirect: "error",
					signal: controller.signal,
				}),
				controller.signal,
			);
			if (response.headers.get("X-Request-ID") !== requestId) {
				await response.body?.cancel();
				throw this.#error(route.operationId, response.status, requestId, {
					code: "invalid_response",
					retryable: false,
				});
			}
			const text = await abortable(response.text(), controller.signal);
			const retryAfterSeconds = retryAfter(response);
			const contentType = responseMediaType(response);
			if (text.length === 0) {
				return {
					status: response.status,
					requestId,
					contentType,
					body: undefined,
					invalidJson: false,
					retryAfterSeconds,
				};
			}
			try {
				return {
					status: response.status,
					requestId,
					contentType,
					body: JSON.parse(text) as unknown,
					invalidJson: false,
					retryAfterSeconds,
				};
			} catch {
				return {
					status: response.status,
					requestId,
					contentType,
					body: undefined,
					invalidJson: true,
					retryAfterSeconds,
				};
			}
		} catch (error) {
			void response?.body?.cancel().catch(() => undefined);
			if (error instanceof GatewayClientError) throw error;
			if (input.signal?.aborted) {
				throw this.#error(route.operationId, null, requestId, {
					code: "aborted",
					retryable: false,
				});
			}
			if (timedOut) {
				throw this.#error(route.operationId, null, requestId, {
					code: "timeout",
					retryable: true,
				});
			}
			throw this.#error(route.operationId, null, requestId, {
				code: "network_error",
				retryable: true,
			});
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", abortFromCaller);
		}
	}

	#httpError(
		operationId: OperationId,
		result: AttemptResult,
	): GatewayClientError {
		const safe = safeErrorFields(result.body);
		return this.#error(operationId, result.status, result.requestId, {
			code: safe.code ?? "http_error",
			retryable:
				safe.retryable ?? (result.status >= 500 || result.status === 429),
			retryAfterSeconds: result.retryAfterSeconds,
		});
	}

	#error(
		operationId: OperationId,
		status: number | null,
		requestId: string,
		fields: {
			code: GatewayErrorCode;
			retryable: boolean;
			retryAfterSeconds?: number | null;
		},
	): GatewayClientError {
		const diagnostic: GatewayDiagnostic = {
			type: "request_failed",
			operationId,
			status,
			requestId,
			code:
				internalErrorCodes.has(fields.code) ||
				isSafeRemoteErrorCode(fields.code)
					? fields.code
					: "request_failed",
			retryable: fields.retryable,
			retryAfterSeconds: fields.retryAfterSeconds ?? null,
		};
		try {
			this.#onDiagnostic?.(diagnostic);
		} catch {
			// Diagnostics never affect requests.
		}
		return new GatewayClientError(diagnostic);
	}

	#sessionChanged(
		operationId: OperationId,
		requestId: string,
	): GatewayClientError {
		return this.#error(operationId, null, requestId, {
			code: "session_changed",
			retryable: false,
		});
	}

	async #assertCurrentSession(
		expected: SessionFingerprint,
		operationId: OperationId,
		requestId: string,
	): Promise<void> {
		const current = await this.#readSession(operationId);
		if (!matchesSessionFingerprint(current, expected)) {
			throw this.#sessionChanged(operationId, requestId);
		}
	}

	async #assertSessionSubject(
		subject: GatewaySessionSubject,
		operationId: OperationId,
		requestId: string,
	): Promise<void> {
		const expected = this.#subjectSession(subject);
		const current = await this.#readSession(operationId);
		if (!matchesSessionFingerprint(current, expected)) {
			throw this.#sessionChanged(operationId, requestId);
		}
	}

	#subjectSession(subject: GatewaySessionSubject): SessionFingerprint {
		const expected = this.#sessionSubjects.get(subject);
		if (!expected || expected.userId !== subject.userId) {
			throw new TypeError("Invalid GatewayClient session subject");
		}
		return expected;
	}

	async #clearSession(
		expected: Session,
	): Promise<"changed" | "cleared" | "unknown"> {
		this.#invalidatedAccessToken = expected.accessToken;
		try {
			return (await this.#sessionStore.compareAndSet(expected, null))
				? "cleared"
				: "changed";
		} catch {
			// The local invalidation above keeps a failed persistent clear fail-closed.
			return "unknown";
		}
	}

	async #readSession(operationId: OperationId): Promise<Session | null> {
		let session: Session | null;
		try {
			session = await this.#sessionStore.get();
		} catch {
			throw this.#error(operationId, null, newIdentifier(this.#requestId), {
				code: "session_store_error",
				retryable: true,
			});
		}
		if (!session) return null;
		if (session.accessToken === this.#invalidatedAccessToken) return null;
		if (this.#invalidatedAccessToken) this.#invalidatedAccessToken = null;
		return session;
	}
}

function routeFor<Id extends OperationId>(
	operationId: Id,
): GatewayRoute & { operationId: Id } {
	const route = gatewayRoutes.find(
		(candidate) => candidate.operationId === operationId,
	);
	if (!route) throw new TypeError("Unknown gateway operation");
	return route as unknown as GatewayRoute & { operationId: Id };
}

function renderPath(
	route: GatewayRoute,
	parameters: Record<string, unknown> | undefined,
	invalid: () => GatewayClientError,
): string {
	let path = route.path;
	for (const name of route.pathParameters) {
		const value = parameters?.[name];
		if (typeof value !== "string" && typeof value !== "number") throw invalid();
		path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
	}
	return path;
}

function appendQuery(
	url: URL,
	route: GatewayRoute,
	parameters: Record<string, unknown> | undefined,
	invalid: () => GatewayClientError,
): void {
	for (const name of route.queryParameters) {
		const value = parameters?.[name];
		if (value === undefined || value === null) continue;
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			if (!["boolean", "number", "string"].includes(typeof item))
				throw invalid();
			url.searchParams.append(name, String(item));
		}
	}
}

function requestHeaders(
	route: GatewayRoute,
	input: RuntimeRequest,
	requestId: string,
	accessToken: string | undefined,
	idempotencyKey: () => string,
	invalid: () => GatewayClientError,
): Headers {
	const headers = new Headers({ "X-Request-ID": requestId });
	const supplied = new Map(
		Object.entries(input.headers ?? {}).map(([name, value]) => [
			name.toLowerCase(),
			value,
		]),
	);
	for (const name of route.headerParameters) {
		const value = supplied.get(name.toLowerCase());
		if (value !== undefined) headers.set(name, String(value));
	}
	const suppliedIdempotencyKey = headers.get("idempotency-key");
	if (
		suppliedIdempotencyKey !== null &&
		!isSafeIdentifier(suppliedIdempotencyKey)
	) {
		throw invalid();
	}
	if (route.idempotency === "required" && !headers.has("idempotency-key")) {
		const generated = idempotencyKey();
		if (!isSafeIdentifier(generated)) throw invalid();
		headers.set("idempotency-key", generated);
	}
	if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
	if (input.body !== undefined) headers.set("Content-Type", "application/json");
	return headers;
}

function safeErrorFields(body: unknown): {
	code?: GatewayErrorCode;
	retryable?: boolean;
} {
	if (!isRecord(body) || !isRecord(body.error)) return {};
	const code = body.error.code;
	const retryable = body.error.retryable;
	return {
		...(typeof code === "string" && isSafeRemoteErrorCode(code)
			? { code }
			: {}),
		...(typeof retryable === "boolean" ? { retryable } : {}),
	};
}

function retryAfter(response: Response): number | null {
	const value = response.headers.get("Retry-After");
	if (!value || !/^\d{1,5}$/.test(value)) return null;
	const seconds = Number(value);
	return Number.isSafeInteger(seconds) && seconds <= 86_400 ? seconds : null;
}

function responseMediaType(response: Response): string | null {
	const value = response.headers.get("Content-Type");
	return value ? (value.split(";", 1)[0]?.trim().toLowerCase() ?? null) : null;
}

function isLoopbackHost(hostname: string): boolean {
	return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
		hostname.toLowerCase(),
	);
}

function sessionFingerprint(session: Session): SessionFingerprint {
	return Object.freeze({
		userId: session.user.id,
		accessToken: session.accessToken,
		refreshToken: session.refreshToken,
	});
}

function sessionWithFingerprint(
	session: Session,
	fingerprint: SessionFingerprint,
): Session {
	const user = Object.freeze({
		...session.user,
		id: fingerprint.userId,
		profile: Object.freeze({ ...session.user.profile }),
	});
	return Object.freeze({
		...session,
		accessToken: fingerprint.accessToken,
		refreshToken: fingerprint.refreshToken,
		user,
	});
}

function sameSessionFingerprint(
	left: SessionFingerprint,
	right: SessionFingerprint,
): boolean {
	return (
		left.userId === right.userId &&
		left.accessToken === right.accessToken &&
		left.refreshToken === right.refreshToken
	);
}

function matchesSessionFingerprint(
	session: Session | null,
	fingerprint: SessionFingerprint,
): boolean {
	return (
		session?.user.id === fingerprint.userId &&
		session.accessToken === fingerprint.accessToken &&
		session.refreshToken === fingerprint.refreshToken
	);
}

function isSuccessData<Id extends OperationId>(
	operationId: Id,
	value: unknown,
	response: GatewaySuccessResponse,
): value is GatewayResponseData<Id> {
	if (response.contentType === null) return value === undefined;
	const matches =
		response.schema !== undefined &&
		matchesGatewaySchema(value, response.schema);
	if (
		!matches ||
		(operationId !== "eventRecapShareLinksResolve" &&
			operationId !== "eventRecapExternalShareLinksResolve")
	)
		return matches;
	if (!isRecord(value) || !isRecord(value.recap)) return false;
	const items = value.recap.items;
	return (
		Array.isArray(items) &&
		items.every((item, index) => isRecord(item) && item.ordinal === index)
	);
}

function matchesGatewaySchema(
	value: unknown,
	schema: GatewayJsonSchema,
	depth = 0,
): boolean {
	if (depth > 128) return false;
	if (schema.$ref) {
		const match = /^#\/components\/schemas\/([^/]+)$/.exec(schema.$ref);
		const referenced = match?.[1] ? gatewaySchemas[match[1]] : undefined;
		if (!referenced || !matchesGatewaySchema(value, referenced, depth + 1)) {
			return false;
		}
	}
	if (
		schema.anyOf &&
		!schema.anyOf.some((candidate) =>
			matchesGatewaySchema(value, candidate, depth + 1),
		)
	) {
		return false;
	}
	if (
		schema.oneOf &&
		schema.oneOf.filter((candidate) =>
			matchesGatewaySchema(value, candidate, depth + 1),
		).length !== 1
	) {
		return false;
	}
	if (schema.enum && !schema.enum.some((item) => jsonEqual(value, item))) {
		return false;
	}
	if (Object.hasOwn(schema, "const") && !jsonEqual(value, schema.const)) {
		return false;
	}
	const types = Array.isArray(schema.type)
		? schema.type
		: schema.type
			? [schema.type]
			: [];
	if (
		types.length > 0 &&
		!types.some((type) => matchesSchemaType(value, type))
	) {
		return false;
	}
	if (value === null && types.includes("null")) return true;
	if (typeof value === "string") {
		const length = [...value].length;
		if (schema.minLength !== undefined && length < schema.minLength)
			return false;
		if (schema.maxLength !== undefined && length > schema.maxLength)
			return false;
		if (schema.pattern !== undefined) {
			try {
				if (!new RegExp(schema.pattern, "u").test(value)) return false;
			} catch {
				return false;
			}
		}
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return false;
		if (schema.minimum !== undefined && value < schema.minimum) return false;
		if (schema.maximum !== undefined && value > schema.maximum) return false;
		if (
			schema.exclusiveMinimum !== undefined &&
			value <= schema.exclusiveMinimum
		) {
			return false;
		}
		if (
			schema.exclusiveMaximum !== undefined &&
			value >= schema.exclusiveMaximum
		) {
			return false;
		}
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			return false;
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			return false;
		}
		const itemSchema = schema.items;
		if (
			itemSchema &&
			!value.every((item) => matchesGatewaySchema(item, itemSchema, depth + 1))
		) {
			return false;
		}
	}
	if (
		(schema.properties ||
			schema.required ||
			schema.additionalProperties !== undefined) &&
		!isRecord(value)
	) {
		return false;
	}
	if (isRecord(value)) {
		if (schema.required?.some((property) => !Object.hasOwn(value, property))) {
			return false;
		}
		for (const [property, child] of Object.entries(value)) {
			const propertySchema = schema.properties?.[property];
			if (propertySchema) {
				if (!matchesGatewaySchema(child, propertySchema, depth + 1))
					return false;
				continue;
			}
			if (schema.additionalProperties === false) return false;
			if (
				typeof schema.additionalProperties === "object" &&
				!matchesGatewaySchema(child, schema.additionalProperties, depth + 1)
			) {
				return false;
			}
		}
	}
	return true;
}

function matchesSchemaType(value: unknown, type: string): boolean {
	switch (type) {
		case "array":
			return Array.isArray(value);
		case "boolean":
			return typeof value === "boolean";
		case "integer":
			return typeof value === "number" && Number.isSafeInteger(value);
		case "null":
			return value === null;
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "object":
			return isRecord(value);
		case "string":
			return typeof value === "string";
		default:
			return false;
	}
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((item, index) => jsonEqual(item, right[index]))
		);
	}
	if (!isRecord(left) || !isRecord(right)) return false;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]),
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveTimeout(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError("Gateway timeout must be positive");
	}
	return value;
}

function randomIdentifier(): string {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
	);
}

function newIdentifier(factory: () => string): string {
	const value = factory();
	if (!isSafeIdentifier(value))
		throw new TypeError("Invalid identifier factory");
	return value;
}

function isSafeIdentifier(value: string): boolean {
	return safeIdentifier.test(value) && !looksSensitive(value);
}

function isSafeRemoteErrorCode(value: string): value is GatewayRemoteErrorCode {
	return gatewayRemoteErrorCodes.has(value);
}

function looksSensitive(value: string): boolean {
	return (
		/^(?:cin_|crs_|rt_|at_|access[_-]|refresh[_-]|bearer[_-]|eyJ)/i.test(
			value,
		) || (value.match(/\./g)?.length ?? 0) >= 2
	);
}

function abortable<Value>(
	promise: Promise<Value>,
	signal: AbortSignal,
): Promise<Value> {
	if (signal.aborted) return Promise.reject(aborted);
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(aborted);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

async function waitForCaller<Value>(
	promise: Promise<Value>,
	signal: AbortSignal | undefined,
	abortError: () => GatewayClientError,
): Promise<Value> {
	if (!signal) return promise;
	try {
		return await abortable(promise, signal);
	} catch (error) {
		if (signal.aborted || error === aborted) throw abortError();
		throw error;
	}
}
