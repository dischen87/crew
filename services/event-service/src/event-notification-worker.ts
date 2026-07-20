import {
	EventNotificationIngressError,
	type EventNotificationIngressResult,
} from "./event-notification-ingress";
import type {
	EventNotificationMaintenance,
	PostgresEventNotificationOutbox,
} from "./event-notification-outbox";
import {
	type EventNotificationPayload,
	type EventNotificationPayloadCodec,
	EventNotificationPayloadKeyUnavailableError,
} from "./event-notification-payload";
import {
	EVENT_NOTIFICATION_ACK_BUFFER_MS,
	type EventNotificationWorkerConfig,
} from "./event-notification-worker-config";

type WorkerConfig = Pick<
	EventNotificationWorkerConfig,
	| "workerId"
	| "pollIntervalMs"
	| "leaseMs"
	| "timeoutMs"
	| "maxAttempts"
	| "baseBackoffMs"
	| "maxBackoffMs"
> &
	Partial<
		Pick<
			EventNotificationWorkerConfig,
			"maintenanceBatchSize" | "terminalRetentionSeconds"
		>
	> & { random?: () => number };

type Ingress = {
	deliver(
		payload: EventNotificationPayload,
	): Promise<EventNotificationIngressResult>;
};

export type EventNotificationWorkerStats = EventNotificationMaintenance & {
	claimed: number;
	delivered: number;
	suppressed: number;
	invalid: number;
	dead: number;
	expired: number;
	retried: number;
	payloadKeyUnavailable: number;
	retryTimeout: number;
	retryRateLimited: number;
	retryIngress: number;
	staleResults: number;
};

export function createEventNotificationWorker(
	config: WorkerConfig,
	outbox: PostgresEventNotificationOutbox,
	codec: EventNotificationPayloadCodec,
	ingress: Ingress,
) {
	validateWorkerId(config.workerId);

	async function processOneWithStats() {
		const stats = emptyStats();
		const claim = await outbox.claim({
			workerId: config.workerId,
			leaseMs: config.leaseMs,
			maxAttempts: config.maxAttempts,
			maintenanceLimit: config.maintenanceBatchSize ?? 100,
		});
		if (!claim) return stats;
		stats.claimed = 1;

		let payload: EventNotificationPayload;
		try {
			payload = codec.open(
				claim.id,
				claim.payloadKid,
				claim.payloadCiphertext,
				claim.expiresAt.toISOString(),
			);
		} catch (error) {
			if (error instanceof EventNotificationPayloadKeyUnavailableError) {
				const result = await outbox.retryUnavailableKey(claim, {
					delayMs: config.baseBackoffMs,
				});
				if (result === "retry") stats.retried = 1;
				else if (result === "expired") stats.expired = 1;
				else stats.staleResults = 1;
				if (result) stats.payloadKeyUnavailable = 1;
				return stats;
			}
			const rejected = await outbox.rejectInvalidPayload(claim);
			if (rejected) stats.invalid = 1;
			else stats.staleResults = 1;
			return stats;
		}

		const permit = await outbox.renewForDelivery(claim, payload, {
			leaseMs: config.leaseMs,
			minimumRemainingMs: config.timeoutMs + EVENT_NOTIFICATION_ACK_BUFFER_MS,
			maxAttempts: config.maxAttempts,
		});
		if (typeof permit === "string") {
			if (permit === "suppressed") stats.suppressed = 1;
			else if (permit === "expired") stats.expired = 1;
			else if (permit === "dead") stats.dead = 1;
			else stats.staleResults = 1;
			return stats;
		}

		let result: EventNotificationIngressResult;
		try {
			result = await ingress.deliver(payload);
		} catch (error) {
			if (error instanceof EventNotificationIngressError && !error.retryable) {
				const completed = await outbox.failPermanent(permit, error.code);
				if (completed) stats.dead = 1;
				else stats.staleResults = 1;
				return stats;
			}
			const ingressError =
				error instanceof EventNotificationIngressError ? error : undefined;
			const retryBackoff = retryDelayMs(
				permit.attempt,
				config.baseBackoffMs,
				config.maxBackoffMs,
				config.random ?? Math.random,
			);
			const retryResult = await outbox.retryDelivery(permit, {
				code: ingressError?.code ?? "NOTIFICATION_INGRESS_UNAVAILABLE",
				delayMs: Math.max(retryBackoff, ingressError?.retryAfterMs ?? 0),
				maxAttempts: config.maxAttempts,
			});
			if (retryResult === "retry") {
				stats.retried = 1;
				if (ingressError?.code === "NOTIFICATION_INGRESS_TIMEOUT")
					stats.retryTimeout = 1;
				else if (ingressError?.code === "NOTIFICATION_INGRESS_RATE_LIMITED")
					stats.retryRateLimited = 1;
				else stats.retryIngress = 1;
			} else if (retryResult === "dead") stats.dead = 1;
			else stats.staleResults = 1;
			return stats;
		}
		const completed = await outbox.complete(permit, result.status);
		if (!completed) stats.staleResults = 1;
		else if (result.status === 202) stats.delivered = 1;
		else stats.suppressed = 1;
		return stats;
	}

	async function processOne() {
		return (await processOneWithStats()).claimed === 1;
	}

	async function tick(): Promise<EventNotificationWorkerStats> {
		const maintenance =
			typeof outbox.maintain === "function"
				? await outbox.maintain({
						retentionSeconds: config.terminalRetentionSeconds ?? 2_592_000,
						limit: config.maintenanceBatchSize ?? 100,
					})
				: emptyMaintenance();
		return { ...(await processOneWithStats()), ...maintenance };
	}

	return {
		id: config.workerId,
		processOne,
		tick,
		async run(signal: AbortSignal) {
			while (!signal.aborted) {
				try {
					const stats = await tick();
					if (Object.values(stats).some((value) => value > 0))
						console.info("Event notification worker batch", stats);
				} catch {
					console.error("Event notification worker tick failed", {
						workerId: config.workerId,
						code: "EVENT_NOTIFICATION_WORKER_TICK_FAILED",
					});
				}
				if (!signal.aborted) await wait(config.pollIntervalMs, signal);
			}
		},
	};
}

function retryDelayMs(
	attempt: number,
	base: number,
	maximum: number,
	random: () => number,
) {
	const exponential = Math.min(maximum, base * 2 ** Math.max(0, attempt - 1));
	const unit = Math.max(0, Math.min(1, random()));
	return Math.max(1, Math.floor(exponential * (0.75 + unit * 0.5)));
}

function wait(milliseconds: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timeout = setTimeout(done, milliseconds);
		signal.addEventListener("abort", done, { once: true });
		function done() {
			clearTimeout(timeout);
			signal.removeEventListener("abort", done);
			resolve();
		}
	});
}

function validateWorkerId(workerId: string) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(workerId))
		throw new Error("Invalid event notification worker ID");
}

function emptyMaintenance(): EventNotificationMaintenance {
	return {
		purgedDelivered: 0,
		purgedSuppressed: 0,
		purgedInvalid: 0,
		purgedDead: 0,
		purgedExpired: 0,
		backlog: 0,
		oldestActiveAgeSeconds: 0,
	};
}

function emptyStats(): EventNotificationWorkerStats {
	return {
		...emptyMaintenance(),
		claimed: 0,
		delivered: 0,
		suppressed: 0,
		invalid: 0,
		dead: 0,
		expired: 0,
		retried: 0,
		payloadKeyUnavailable: 0,
		retryTimeout: 0,
		retryRateLimited: 0,
		retryIngress: 0,
		staleResults: 0,
	};
}
