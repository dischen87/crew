import { afterAll, beforeAll, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createId, hashSecret } from "./auth";
import { PostgresIdentityRetention } from "./identity-retention";

const databaseUrl = Bun.env.USER_DATABASE_URL;

if (!databaseUrl) {
	test.skip("identity retention (set USER_DATABASE_URL)", () => {});
} else {
	let sql: Sql;
	let retention: PostgresIdentityRetention;
	const suffix = crypto.randomUUID();
	const scope = `retention:${suffix}`;
	const email = `retention-${suffix}@example.com`;
	const userId = createId("usr");
	const magicLinkIds = Array.from({ length: 4 }, () => createId("ml"));
	const familyIds = Array.from({ length: 4 }, () => createId("ses"));
	const sessionIds = Array.from({ length: 4 }, () => createId("ses"));

	beforeAll(async () => {
		sql = postgres(databaseUrl, { onnotice: () => {} });
		await migrate(sql);
		retention = new PostgresIdentityRetention(sql);
		await seedExpiredAndActiveRows();
	});

	afterAll(async () => {
		await sql`DELETE FROM user_idempotency_records WHERE scope = ${scope}`;
		await sql`DELETE FROM user_magic_links WHERE email = ${email}`;
		await sql`DELETE FROM users WHERE id = ${userId}`;
		await sql.end();
	});

	test("purges terminal identity data in bounded batches and reports exact metrics", async () => {
		const input = {
			batchSize: 2,
			magicLinkRetentionSeconds: 86_400,
			sessionRetentionSeconds: 86_400,
		};
		expect(await retention.purgeOnce(input)).toEqual({
			idempotencyRecords: 2,
			magicLinks: 2,
			sessions: 2,
			sessionFamilies: 2,
		});
		expect(await expiredCounts()).toEqual({
			idempotencyRecords: 1,
			magicLinks: 1,
			sessions: 1,
			sessionFamilies: 0,
		});
		expect(await retention.purgeOnce(input)).toEqual({
			idempotencyRecords: 1,
			magicLinks: 1,
			sessions: 1,
			sessionFamilies: 1,
		});
		expect(await retention.purgeOnce(input)).toEqual({
			idempotencyRecords: 0,
			magicLinks: 0,
			sessions: 0,
			sessionFamilies: 0,
		});
		const [active] = await sql<
			{
				idempotencyRecords: number;
				magicLinks: number;
				sessions: number;
				sessionFamilies: number;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM user_idempotency_records
				 WHERE scope = ${scope}) AS "idempotencyRecords",
				(SELECT count(*)::int FROM user_magic_links
				 WHERE email = ${email}) AS "magicLinks",
				(SELECT count(*)::int FROM user_sessions
				 WHERE user_id = ${userId}) AS sessions,
				(SELECT count(*)::int FROM user_session_families
				 WHERE user_id = ${userId}) AS "sessionFamilies"
		`;
		expect(active).toEqual({
			idempotencyRecords: 1,
			magicLinks: 1,
			sessions: 1,
			sessionFamilies: 1,
		});
	});

	async function seedExpiredAndActiveRows() {
		await sql`
			INSERT INTO users (id, email, email_verified_at, created_at)
			VALUES (${userId}, ${email}, clock_timestamp(), clock_timestamp())
		`;
		await sql`
			INSERT INTO user_idempotency_records (
				scope, operation_id, idempotency_key, fingerprint, state,
				response_status, response_payload, response_headers,
				created_at, completed_at, expires_at
			)
			SELECT
				${scope}, 'identityRetentionProof',
				'retention-expired-' || value || '-' || ${suffix},
				${hashSecret(`retention-expired-${suffix}`)}, 'completed',
				200, 'expired', '{}'::jsonb,
				clock_timestamp() - INTERVAL '400 days',
				clock_timestamp() - INTERVAL '366 days',
				clock_timestamp() - INTERVAL '365 days'
			FROM generate_series(1, 3) AS value
		`;
		await sql`
			INSERT INTO user_idempotency_records (
				scope, operation_id, idempotency_key, fingerprint, state,
				response_status, response_payload, response_headers,
				created_at, completed_at, expires_at
			) VALUES (
				${scope}, 'identityRetentionProof', ${`retention-active-${suffix}`},
				${hashSecret(`retention-active-${suffix}`)}, 'completed',
				200, 'active', '{}'::jsonb,
				clock_timestamp(), clock_timestamp(),
				clock_timestamp() + INTERVAL '31 days'
			)
		`;
		for (const [index, id] of magicLinkIds.entries()) {
			const active = index === magicLinkIds.length - 1;
			const consumed = index === 0;
			await sql`
				INSERT INTO user_magic_links (
					id, email, token_hash, expires_at, consumed_at, created_at
				) VALUES (
					${id}, ${email}, ${hashSecret(`magic-retention-${suffix}-${index}`)},
					${active || consumed ? sql`clock_timestamp() + INTERVAL '1 day'` : sql`clock_timestamp() - INTERVAL '365 days'`},
					${consumed ? sql`clock_timestamp() - INTERVAL '365 days'` : null},
					clock_timestamp() - INTERVAL '400 days'
				)
			`;
		}
		for (const [index, familyId] of familyIds.entries()) {
			const active = index === familyIds.length - 1;
			const sessionId = sessionIds[index];
			if (!sessionId) throw new Error("Missing retention test session ID");
			await sql`
				INSERT INTO user_session_families (id, user_id, created_at)
				VALUES (
					${familyId}, ${userId},
					${active ? sql`clock_timestamp()` : sql`clock_timestamp() - INTERVAL '400 days'`}
				)
			`;
			await sql`
				INSERT INTO user_sessions (
					id, user_id, family_id, refresh_token_hash, expires_at, created_at
				) VALUES (
					${sessionId}, ${userId}, ${familyId},
					${hashSecret(`session-retention-${suffix}-${index}`)},
					${active ? sql`clock_timestamp() + INTERVAL '31 days'` : sql`clock_timestamp() - INTERVAL '365 days'`},
					${active ? sql`clock_timestamp()` : sql`clock_timestamp() - INTERVAL '400 days'`}
				)
			`;
		}
	}

	async function expiredCounts() {
		const [counts] = await sql<
			{
				idempotencyRecords: number;
				magicLinks: number;
				sessions: number;
				sessionFamilies: number;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM user_idempotency_records
				 WHERE scope = ${scope} AND response_payload = 'expired')
					AS "idempotencyRecords",
				(SELECT count(*)::int FROM user_magic_links
				 WHERE email = ${email}
					AND (expires_at < clock_timestamp() OR consumed_at IS NOT NULL))
					AS "magicLinks",
				(SELECT count(*)::int FROM user_sessions
				 WHERE user_id = ${userId} AND expires_at < clock_timestamp())
					AS sessions,
				(SELECT count(*)::int FROM user_session_families AS family
				 WHERE family.user_id = ${userId}
					AND NOT EXISTS (
						SELECT 1 FROM user_sessions AS session
						WHERE session.family_id = family.id
					)) AS "sessionFamilies"
		`;
		return counts;
	}
}
