import type { PushDeliveryPayload } from "./push-payload";

export type SendPushNotification = (
	input: PushDeliveryPayload & {
		requestId: string;
		causationRequestId: string;
		deliveryKey: string;
		signal?: AbortSignal;
	},
) => Promise<void>;

export class PushDeliveryError extends Error {
	constructor(
		readonly code: string,
		readonly retryAfterMs?: number,
	) {
		super("Push delivery failed");
	}
}

export function createWebhookPushSender(options: {
	endpoint: string;
	bearer: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}): SendPushNotification {
	const endpoint = new URL(options.endpoint);
	const timeoutMs = options.timeoutMs ?? 3_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
		throw new Error("Push delivery timeout must be positive");
	}
	const fetcher = options.fetch ?? fetch;

	return async ({
		pushToken,
		category,
		templateKey,
		deepLink,
		locale,
		expiresAt,
		requestId,
		causationRequestId,
		deliveryKey,
		signal,
	}) => {
		let response: Response;
		try {
			response = await fetcher(endpoint, {
				method: "POST",
				redirect: "error",
				headers: {
					Authorization: `Bearer ${options.bearer}`,
					"Content-Type": "application/json",
					"Idempotency-Key": deliveryKey,
					"X-Request-ID": requestId,
					"X-Causation-Request-ID": causationRequestId,
				},
				body: JSON.stringify({
					pushToken,
					category,
					templateKey,
					deepLink,
					locale,
					expiresAt: expiresAt.toISOString(),
				}),
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
					: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new PushDeliveryError(
				error instanceof DOMException && error.name === "TimeoutError"
					? "provider_timeout"
					: "provider_network",
			);
		}
		if (!response.ok) {
			throw new PushDeliveryError(
				`provider_${response.status}`,
				parseRetryAfter(response.headers.get("Retry-After"), Date.now()),
			);
		}
	};
}

function parseRetryAfter(value: string | null, nowMs: number) {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.ceil(seconds * 1_000);
	}
	const at = Date.parse(value);
	return Number.isFinite(at) && at > nowMs ? at - nowMs : undefined;
}
