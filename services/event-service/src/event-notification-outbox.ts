import type { Sql } from "postgres";
import type { EventNotificationPayload } from "./event-notification-payload";

type Tx = Sql;
const DEFAULT_MAINTENANCE_LIMIT = 100;

export type EventNotificationMaintenance = {
	purgedDelivered: number;
	purgedSuppressed: number;
	purgedInvalid: number;
	purgedDead: number;
	purgedExpired: number;
	backlog: number;
	oldestActiveAgeSeconds: number;
};

export type EventNotificationClaim = {
	id: string;
	payloadKid: string;
	payloadCiphertext: string;
	expiresAt: Date;
	workerId: string;
	fence: string;
	attempts: number;
	keyFailures: number;
};

export type DeliveryPermit = EventNotificationClaim & { attempt: number };

export class PostgresEventNotificationOutbox {
	constructor(private readonly sql: Sql) {}

	async maintain(input: {
		retentionSeconds: number;
		limit?: number;
	}): Promise<EventNotificationMaintenance> {
		const limit = input.limit ?? DEFAULT_MAINTENANCE_LIMIT;
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const purged = await tx<
				{
					status: "delivered" | "suppressed" | "invalid" | "dead" | "expired";
				}[]
			>`
				WITH purgeable AS (
					SELECT id
					FROM event_notification_outbox
					WHERE status IN ('delivered', 'suppressed', 'invalid', 'dead', 'expired')
						AND completed_at <= clock_timestamp()
							- (${input.retentionSeconds} * interval '1 second')
					ORDER BY completed_at, id
					FOR UPDATE SKIP LOCKED
					LIMIT ${limit}
				)
				DELETE FROM event_notification_outbox AS jobs
				USING purgeable
				WHERE jobs.id = purgeable.id
				RETURNING jobs.status
			`;
			const [health] = await tx<
				{ backlog: number; oldestActiveAgeSeconds: number }[]
			>`
				SELECT
					count(*)::int AS backlog,
					COALESCE(
						GREATEST(
							0,
							floor(EXTRACT(EPOCH FROM (clock_timestamp() - min(created_at))))
						)::int,
						0
					) AS "oldestActiveAgeSeconds"
				FROM event_notification_outbox
				WHERE status IN ('pending', 'processing', 'retry')
			`;
			return {
				purgedDelivered: countStatus(purged, "delivered"),
				purgedSuppressed: countStatus(purged, "suppressed"),
				purgedInvalid: countStatus(purged, "invalid"),
				purgedDead: countStatus(purged, "dead"),
				purgedExpired: countStatus(purged, "expired"),
				backlog: health?.backlog ?? 0,
				oldestActiveAgeSeconds: health?.oldestActiveAgeSeconds ?? 0,
			};
		}) as Promise<EventNotificationMaintenance>;
	}

	async claim(input: {
		workerId: string;
		leaseMs: number;
		maxAttempts: number;
		maintenanceLimit?: number;
	}): Promise<EventNotificationClaim | null> {
		const maintenanceLimit =
			input.maintenanceLimit ?? DEFAULT_MAINTENANCE_LIMIT;
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			await tx`
				WITH expired_jobs AS (
					SELECT id FROM event_notification_outbox
					WHERE expires_at <= clock_timestamp() AND (
						status IN ('pending', 'retry') OR
						(status = 'processing' AND lease_until <= clock_timestamp())
					)
					ORDER BY expires_at, id
					FOR UPDATE SKIP LOCKED LIMIT ${maintenanceLimit}
				)
				UPDATE event_notification_outbox AS jobs SET
					status = 'expired', outcome_code = 'NOTIFICATION_EXPIRED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = clock_timestamp(), updated_at = clock_timestamp()
				FROM expired_jobs
				WHERE jobs.id = expired_jobs.id
			`;
			await tx`
				WITH exhausted_jobs AS (
					SELECT id FROM event_notification_outbox
					WHERE attempts >= ${input.maxAttempts} AND (
						(status IN ('pending', 'retry') AND available_at <= clock_timestamp()) OR
						(status = 'processing' AND lease_until <= clock_timestamp())
					)
					ORDER BY COALESCE(lease_until, available_at), id
					FOR UPDATE SKIP LOCKED LIMIT ${maintenanceLimit}
				)
				UPDATE event_notification_outbox AS jobs SET
					status = 'dead', outcome_code = 'NOTIFICATION_ATTEMPTS_EXHAUSTED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = clock_timestamp(), updated_at = clock_timestamp()
				FROM exhausted_jobs
				WHERE jobs.id = exhausted_jobs.id
			`;
			const [candidate] = await tx<{ id: string }[]>`
				SELECT id FROM event_notification_outbox
				WHERE attempts < ${input.maxAttempts}
					AND expires_at > clock_timestamp() AND (
					(status IN ('pending', 'retry') AND available_at <= clock_timestamp()) OR
					(status = 'processing' AND lease_until <= clock_timestamp())
				)
				ORDER BY COALESCE(lease_until, available_at), id
				FOR UPDATE SKIP LOCKED LIMIT 1
			`;
			if (!candidate) return null;
			const [job] = await tx<
				{
					id: string;
					payloadKid: string;
					payloadCiphertext: string;
					expiresAt: Date;
					fence: string;
					attempts: number;
					keyFailures: number;
				}[]
			>`
				UPDATE event_notification_outbox SET
					status = 'processing', lease_owner = ${input.workerId},
					lease_until = clock_timestamp() + (${input.leaseMs} * interval '1 millisecond'),
					fence = fence + 1, updated_at = clock_timestamp()
				WHERE id = ${candidate.id}
				RETURNING id, payload_kid AS "payloadKid",
					payload_ciphertext AS "payloadCiphertext", fence::text AS fence,
					expires_at AS "expiresAt", attempts,
					key_failures AS "keyFailures"
			`;
			if (!job) throw new Error("Event notification claim invariant failed");
			return { ...job, workerId: input.workerId };
		}) as Promise<EventNotificationClaim | null>;
	}

	async retryUnavailableKey(
		claim: EventNotificationClaim,
		input: { delayMs: number },
	) {
		const rows = await this.sql<{ status: "retry" | "expired" }[]>`
			UPDATE event_notification_outbox SET
				status = CASE WHEN expires_at <= clock_timestamp()
					THEN 'expired' ELSE 'retry' END,
				key_failures = LEAST(key_failures + 1, 32),
				outcome_code = CASE WHEN expires_at <= clock_timestamp()
					THEN 'NOTIFICATION_EXPIRED'
					ELSE 'NOTIFICATION_PAYLOAD_KEY_UNAVAILABLE' END,
				available_at = LEAST(
					expires_at,
					clock_timestamp() + (${boundedKeyDelay(input.delayMs)} * interval '1 millisecond')
				),
				lease_owner = NULL, lease_until = NULL,
				completed_at = CASE WHEN expires_at <= clock_timestamp()
					THEN clock_timestamp() ELSE NULL END,
				updated_at = clock_timestamp()
			WHERE ${ownedLease(this.sql, claim)}
			RETURNING status
		`;
		return rows[0]?.status ?? null;
	}

	async rejectInvalidPayload(claim: EventNotificationClaim) {
		return this.finish(claim, "invalid", "NOTIFICATION_PAYLOAD_INVALID");
	}

	async renewForDelivery(
		claim: EventNotificationClaim,
		payload: EventNotificationPayload,
		input: { leaseMs: number; minimumRemainingMs: number; maxAttempts: number },
	): Promise<DeliveryPermit | "stale" | "suppressed" | "expired" | "dead"> {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [job] = await tx<{ id: string }[]>`
				SELECT id FROM event_notification_outbox
				WHERE ${ownedLease(tx, claim)}
				FOR UPDATE
			`;
			if (!job) return "stale" as const;
			const [root] = await tx<{ rootEventId: string }[]>`
				SELECT root_event_id AS "rootEventId" FROM event_roots
				WHERE root_event_id = ${payload.deepLink.rootEventId}
					AND ownership_state = 'next'
				FOR SHARE
			`;
			const [leasedJob] = await tx<{ attempts: number }[]>`
				SELECT attempts FROM event_notification_outbox
				WHERE ${ownedLease(tx, claim)}
			`;
			if (!leasedJob) return "stale" as const;
			if (!root) {
				await finishOwned(
					tx,
					claim,
					"suppressed",
					"NOTIFICATION_NO_LONGER_ELIGIBLE",
				);
				return "suppressed" as const;
			}
			if (leasedJob.attempts >= input.maxAttempts) {
				await finishOwned(tx, claim, "dead", "NOTIFICATION_ATTEMPTS_EXHAUSTED");
				return "dead" as const;
			}
			const [clock] = await tx<{ deliverable: boolean }[]>`
				SELECT ${payload.expiresAt}::timestamptz >
					clock_timestamp() + (${input.minimumRemainingMs} * interval '1 millisecond')
					AS deliverable
			`;
			if (!clock?.deliverable) {
				await finishOwned(tx, claim, "expired", "NOTIFICATION_EXPIRED");
				return "expired" as const;
			}
			const [eligible] = await tx<{ eligible: boolean }[]>`
				SELECT EXISTS (
					SELECT 1 FROM event_feed_entries entry
					WHERE entry.root_event_id = ${payload.deepLink.rootEventId}
						AND entry.id = ${payload.deepLink.feedEntryId}
						AND entry.event_id IS NOT DISTINCT FROM ${payload.deepLink.eventId ?? null}
						AND event_feed_recipient_can_read(
							entry.root_event_id, entry.id, ${payload.recipientUserId}
						)
				) AS eligible
			`;
			if (!eligible?.eligible) {
				await finishOwned(
					tx,
					claim,
					"suppressed",
					"NOTIFICATION_NO_LONGER_ELIGIBLE",
				);
				return "suppressed" as const;
			}
			const [renewed] = await tx<{ attempt: number; fence: string }[]>`
				UPDATE event_notification_outbox SET
					attempts = attempts + 1,
					lease_until = clock_timestamp() + (${input.leaseMs} * interval '1 millisecond'),
					fence = fence + 1, outcome_code = NULL,
					updated_at = clock_timestamp()
				WHERE ${ownedLease(tx, claim)}
					AND expires_at > clock_timestamp()
						+ (${input.minimumRemainingMs} * interval '1 millisecond')
				RETURNING attempts AS attempt, fence::text AS fence
			`;
			if (!renewed) return "stale" as const;
			return { ...claim, attempt: renewed.attempt, fence: renewed.fence };
		}) as Promise<DeliveryPermit | "stale" | "suppressed" | "expired" | "dead">;
	}

	async complete(claim: DeliveryPermit, status: 202 | 204) {
		return this.finish(
			claim,
			status === 202 ? "delivered" : "suppressed",
			status === 202 ? "NOTIFICATION_ACCEPTED" : "NOTIFICATION_SUPPRESSED",
		);
	}

	async failPermanent(claim: DeliveryPermit, code: string) {
		return this.finish(claim, "dead", safeCode(code));
	}

	async retryDelivery(
		claim: DeliveryPermit,
		input: { code: string; delayMs: number; maxAttempts: number },
	) {
		const dead = claim.attempt >= input.maxAttempts;
		const rows = await this.sql<{ status: "retry" | "dead" }[]>`
			UPDATE event_notification_outbox SET
				status = ${dead ? "dead" : "retry"}, outcome_code = ${safeCode(input.code)},
				available_at = clock_timestamp() + (${boundedDelay(input.delayMs)} * interval '1 millisecond'),
				lease_owner = NULL, lease_until = NULL,
				completed_at = CASE WHEN ${dead} THEN clock_timestamp() ELSE NULL END,
				updated_at = clock_timestamp()
			WHERE ${ownedLease(this.sql, claim)}
			RETURNING status
		`;
		return rows[0]?.status ?? null;
	}

	private async finish(
		claim: EventNotificationClaim,
		status: "delivered" | "suppressed" | "invalid" | "dead" | "expired",
		code: string,
	) {
		const rows = await this.sql`
			UPDATE event_notification_outbox SET
				status = ${status}, outcome_code = ${safeCode(code)},
				lease_owner = NULL, lease_until = NULL,
				completed_at = clock_timestamp(), updated_at = clock_timestamp()
			WHERE ${ownedLease(this.sql, claim)}
			RETURNING id
		`;
		return rows.length === 1;
	}
}

function ownedLease(tx: Tx, claim: EventNotificationClaim) {
	return tx`
		id = ${claim.id} AND status = 'processing'
		AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
		AND lease_until > clock_timestamp()
	`;
}

async function finishOwned(
	tx: Tx,
	claim: EventNotificationClaim,
	status: "suppressed" | "dead" | "expired",
	code: string,
) {
	await tx`
		UPDATE event_notification_outbox SET
			status = ${status}, outcome_code = ${code}, lease_owner = NULL,
			lease_until = NULL, completed_at = clock_timestamp(),
			updated_at = clock_timestamp()
		WHERE ${ownedLease(tx, claim)}
	`;
}

function safeCode(value: string) {
	return /^[A-Z][A-Z0-9_]{1,127}$/.test(value)
		? value
		: "NOTIFICATION_DELIVERY_FAILED";
}

function boundedDelay(milliseconds: number) {
	return Math.max(100, Math.min(60 * 60 * 1000, Math.floor(milliseconds)));
}

function boundedKeyDelay(milliseconds: number) {
	return Math.max(10_000, Math.min(60_000, Math.floor(milliseconds)));
}

function countStatus(rows: Array<{ status: string }>, status: string): number {
	return rows.filter((row) => row.status === status).length;
}
