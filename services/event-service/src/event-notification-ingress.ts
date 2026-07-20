import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { EventNotificationPayload } from "./event-notification-payload";
import { isEventNotificationPayloadKey } from "./event-notification-payload";

export type EventNotificationIngressResult = { status: 202 | 204 };

export class EventNotificationIngressError extends Error {
	constructor(
		readonly code: string,
		readonly retryable: boolean,
		readonly retryAfterMs?: number,
	) {
		super("Event notification ingress failed");
	}
}

type Fetch = typeof fetch;

export class EventNotificationIngressClient {
	private readonly endpoint: URL;
	private readonly key: Uint8Array;

	constructor(
		private readonly config: {
			baseUrl: string;
			timeoutMs: number;
			issuer: string;
			audience: string;
			serviceAuthKeyId: string;
			serviceAuthKey: string;
		},
		private readonly request: Fetch = fetch,
	) {
		this.endpoint = new URL("/internal/v1/event-notifications", config.baseUrl);
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.serviceAuthKeyId))
			throw new Error("Invalid event notification service-auth key ID");
		if (!isEventNotificationPayloadKey(config.serviceAuthKey))
			throw new Error(
				"Event notification service-auth keys must be 32-byte base64url values",
			);
		this.key = new Uint8Array(Buffer.from(config.serviceAuthKey, "base64url"));
	}

	async deliver(payload: EventNotificationPayload) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const token = await new SignJWT({
				scope: "user:event-notifications:write",
			})
				.setProtectedHeader({
					alg: "HS256",
					kid: this.config.serviceAuthKeyId,
					typ: "JWT",
				})
				.setIssuer(this.config.issuer)
				.setAudience(this.config.audience)
				.setSubject("event-service")
				.setIssuedAt()
				.setExpirationTime("5m")
				.setJti(randomUUID())
				.sign(this.key);
			const response = await this.request(this.endpoint, {
				method: "POST",
				redirect: "error",
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"Idempotency-Key": payload.requestId,
					"X-Request-ID": payload.requestId,
					"X-Causation-Request-ID": payload.causationRequestId,
				},
				body: JSON.stringify({
					recipientUserId: payload.recipientUserId,
					category: payload.category,
					templateKey: payload.templateKey,
					deepLink: payload.deepLink,
					expiresAt: payload.expiresAt,
				}),
			});
			if (response.status === 202 || response.status === 204) {
				await cancelResponseBody(response);
				return { status: response.status } as EventNotificationIngressResult;
			}
			const failure = responseError(response);
			await cancelResponseBody(response);
			throw failure;
		} catch (error) {
			if (error instanceof EventNotificationIngressError) throw error;
			throw new EventNotificationIngressError(
				controller.signal.aborted
					? "NOTIFICATION_INGRESS_TIMEOUT"
					: "NOTIFICATION_INGRESS_UNAVAILABLE",
				true,
			);
		} finally {
			clearTimeout(timeout);
		}
	}
}

function responseError(response: Response) {
	const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
	if (response.status === 409) {
		return new EventNotificationIngressError(
			"NOTIFICATION_INGRESS_CONFLICT",
			retryAfterMs !== undefined,
			retryAfterMs,
		);
	}
	if (response.status === 400 || response.status === 413) {
		return new EventNotificationIngressError(
			"NOTIFICATION_INGRESS_REJECTED",
			false,
		);
	}
	if (response.status === 401) {
		return new EventNotificationIngressError(
			"NOTIFICATION_INGRESS_UNAUTHENTICATED",
			true,
			retryAfterMs,
		);
	}
	if (response.status === 429) {
		return new EventNotificationIngressError(
			"NOTIFICATION_INGRESS_RATE_LIMITED",
			true,
			retryAfterMs,
		);
	}
	if (
		response.status === 408 ||
		response.status === 425 ||
		response.status >= 500
	) {
		return new EventNotificationIngressError(
			"NOTIFICATION_INGRESS_UNAVAILABLE",
			true,
			retryAfterMs,
		);
	}
	return new EventNotificationIngressError(
		"NOTIFICATION_INGRESS_REJECTED",
		false,
	);
}

async function cancelResponseBody(response: Response) {
	await response.body?.cancel().catch(() => undefined);
}

function parseRetryAfter(value: string | null) {
	if (!value) return undefined;
	if (/^\d+$/.test(value))
		return Math.min(Number(value) * 1000, 60 * 60 * 1000);
	const at = Date.parse(value);
	if (!Number.isFinite(at)) return undefined;
	return Math.max(0, Math.min(at - Date.now(), 60 * 60 * 1000));
}
