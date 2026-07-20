export type SendMagicLink = (input: {
	email: string;
	token: string;
	expiresAt: Date;
	requestId: string;
	deliveryKey: string;
	signal?: AbortSignal;
}) => Promise<void>;

export class MagicLinkDeliveryError extends Error {
	constructor(
		readonly code: string,
		readonly retryAfterMs?: number,
	) {
		super("Magic-link delivery failed");
	}
}

export function createWebhookMagicLinkSender(options: {
	endpoint: string;
	bearer: string;
	appUrl: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}): SendMagicLink {
	const endpoint = new URL(options.endpoint);
	const appUrl = new URL(options.appUrl);
	const timeoutMs = options.timeoutMs ?? 3_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
		throw new Error("Magic-link delivery timeout must be positive");
	}
	const fetcher = options.fetch ?? fetch;

	return async ({
		email,
		token,
		expiresAt,
		requestId,
		deliveryKey,
		signal,
	}) => {
		const link = new URL(appUrl);
		link.searchParams.set("token", token);
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
				},
				body: JSON.stringify({
					email,
					link: link.toString(),
					expiresAt: expiresAt.toISOString(),
				}),
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
					: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new MagicLinkDeliveryError(
				error instanceof DOMException && error.name === "TimeoutError"
					? "provider_timeout"
					: "provider_network",
			);
		}
		if (!response.ok) {
			throw new MagicLinkDeliveryError(
				`provider_${response.status}`,
				parseRetryAfter(response.headers.get("Retry-After"), Date.now()),
			);
		}
	};
}

export const unavailableMagicLinkSender: SendMagicLink = async () => {
	throw new MagicLinkDeliveryError("provider_unconfigured");
};

function parseRetryAfter(value: string | null, nowMs: number) {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.ceil(seconds * 1_000);
	}
	const at = Date.parse(value);
	return Number.isFinite(at) && at > nowMs ? at - nowMs : undefined;
}
