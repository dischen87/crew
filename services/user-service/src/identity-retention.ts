import type { Sql } from "postgres";

export type IdentityRetentionStats = {
	idempotencyRecords: number;
	magicLinks: number;
	sessions: number;
	sessionFamilies: number;
};

export class PostgresIdentityRetention {
	constructor(private readonly sql: Sql) {}

	async purgeOnce(input: {
		batchSize: number;
		magicLinkRetentionSeconds: number;
		sessionRetentionSeconds: number;
	}): Promise<IdentityRetentionStats> {
		validateInput(input);
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const idempotencyRecords = await sql<{ id: string }[]>`
				WITH purgeable AS (
					SELECT scope, operation_id, idempotency_key
					FROM user_idempotency_records
					WHERE expires_at <= clock_timestamp()
					ORDER BY expires_at, scope, operation_id, idempotency_key
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.batchSize}
				)
				DELETE FROM user_idempotency_records AS records
				USING purgeable
				WHERE records.scope = purgeable.scope
					AND records.operation_id = purgeable.operation_id
					AND records.idempotency_key = purgeable.idempotency_key
				RETURNING records.idempotency_key AS id
			`;
			const magicLinks = await sql<{ id: string }[]>`
				WITH purgeable AS (
					SELECT id
					FROM user_magic_links
					WHERE expires_at <= clock_timestamp()
						- ${input.magicLinkRetentionSeconds} * INTERVAL '1 second'
						OR consumed_at <= clock_timestamp()
						- ${input.magicLinkRetentionSeconds} * INTERVAL '1 second'
					ORDER BY LEAST(expires_at, COALESCE(consumed_at, expires_at)), id
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.batchSize}
				)
				DELETE FROM user_magic_links AS links
				USING purgeable
				WHERE links.id = purgeable.id
				RETURNING links.id
			`;
			const sessions = await sql<{ id: string }[]>`
				WITH purgeable AS (
					SELECT session.id
					FROM user_sessions AS session
					WHERE (
						session.expires_at <= clock_timestamp()
							- ${input.sessionRetentionSeconds} * INTERVAL '1 second'
						OR session.rotated_at <= clock_timestamp()
							- ${input.sessionRetentionSeconds} * INTERVAL '1 second'
						OR session.revoked_at <= clock_timestamp()
							- ${input.sessionRetentionSeconds} * INTERVAL '1 second'
					)
					AND NOT EXISTS (
						SELECT 1
						FROM user_sessions AS predecessor
						WHERE predecessor.replaced_by_session_id = session.id
					)
					ORDER BY LEAST(
						session.expires_at,
						COALESCE(session.rotated_at, session.expires_at),
						COALESCE(session.revoked_at, session.expires_at)
					), session.id
					FOR UPDATE OF session SKIP LOCKED
					LIMIT ${input.batchSize}
				)
				DELETE FROM user_sessions AS sessions
				USING purgeable
				WHERE sessions.id = purgeable.id
				RETURNING sessions.id
			`;
			const sessionFamilies = await sql<{ id: string }[]>`
				WITH purgeable AS (
					SELECT family.id
					FROM user_session_families AS family
					WHERE NOT EXISTS (
						SELECT 1 FROM user_sessions AS session
						WHERE session.family_id = family.id
					)
					AND COALESCE(family.revoked_at, family.created_at)
						<= clock_timestamp()
							- ${input.sessionRetentionSeconds} * INTERVAL '1 second'
					ORDER BY COALESCE(family.revoked_at, family.created_at), family.id
					FOR UPDATE OF family SKIP LOCKED
					LIMIT ${input.batchSize}
				)
				DELETE FROM user_session_families AS families
				USING purgeable
				WHERE families.id = purgeable.id
				RETURNING families.id
			`;
			return {
				idempotencyRecords: idempotencyRecords.length,
				magicLinks: magicLinks.length,
				sessions: sessions.length,
				sessionFamilies: sessionFamilies.length,
			};
		}) as Promise<IdentityRetentionStats>;
	}
}

function validateInput(input: {
	batchSize: number;
	magicLinkRetentionSeconds: number;
	sessionRetentionSeconds: number;
}) {
	if (
		!Number.isInteger(input.batchSize) ||
		input.batchSize < 1 ||
		input.batchSize > 1_000
	)
		throw new Error("Invalid identity retention batch size");
	for (const seconds of [
		input.magicLinkRetentionSeconds,
		input.sessionRetentionSeconds,
	]) {
		if (!Number.isInteger(seconds) || seconds < 3_600 || seconds > 31_536_000)
			throw new Error("Invalid identity retention interval");
	}
}
