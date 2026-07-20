import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { PostgresDeliveryOutboxRepository } from "./delivery-outbox";
import { PostgresPushOutboxRepository } from "./push-outbox";

const databaseUrl = Bun.env.USER_DATABASE_URL;

if (!databaseUrl) {
	test.skip("Postgres outbox operations (set USER_DATABASE_URL)", () => {});
} else {
	describe("Postgres outbox operations", () => {
		let sql: Sql;
		let delivery: PostgresDeliveryOutboxRepository;
		let push: PostgresPushOutboxRepository;
		const suffix = crypto.randomUUID().replaceAll("-", "");
		const magicLinkIds: string[] = [];
		const pushJobIds: string[] = [];

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 4, onnotice: () => {} });
			await migrate(sql);
			delivery = new PostgresDeliveryOutboxRepository(sql);
			push = new PostgresPushOutboxRepository(sql);
		});

		afterAll(async () => {
			if (pushJobIds.length > 0)
				await sql`DELETE FROM user_push_outbox WHERE id IN ${sql(pushJobIds)}`;
			if (magicLinkIds.length > 0)
				await sql`DELETE FROM user_magic_links WHERE id IN ${sql(magicLinkIds)}`;
			await sql.end();
		});

		test("purges delivery terminal rows in bounded batches and reports age", async () => {
			const now = new Date();
			await insertDelivery("delivered-old", "delivered", daysAgo(now, 40));
			await insertDelivery("dead-old", "dead_letter", daysAgo(now, 39));
			await insertDelivery("delivered-recent", "delivered", daysAgo(now, 2));
			await insertDelivery("pending", "pending", hoursAgo(now, 2));

			const first = await delivery.maintain({
				now,
				retentionMs: 30 * 24 * 60 * 60 * 1_000,
				limit: 1,
			});
			expect(first.purgedDelivered + first.purgedDeadLetter).toBe(1);
			expect(first.backlog).toBe(1);
			expect(first.oldestActiveAgeSeconds).toBeGreaterThanOrEqual(7_199);

			const second = await delivery.maintain({
				now,
				retentionMs: 30 * 24 * 60 * 60 * 1_000,
				limit: 1,
			});
			expect(second.purgedDelivered + second.purgedDeadLetter).toBe(1);
			const [remaining] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM user_delivery_outbox
				WHERE id IN ${sql(deliveryJobIds())}
			`;
			expect(remaining?.count).toBe(2);
		});

		test("purges delivered, suppressed and dead push rows with fixed metrics", async () => {
			const now = new Date();
			await insertPush("delivered-old", "delivered", daysAgo(now, 42));
			await insertPush("suppressed-old", "suppressed", daysAgo(now, 41));
			await insertPush("dead-old", "dead_letter", daysAgo(now, 40));
			await insertPush("pending", "pending", hoursAgo(now, 3));

			const first = await push.maintain({
				now,
				retentionMs: 30 * 24 * 60 * 60 * 1_000,
				limit: 2,
			});
			expect(
				first.purgedDelivered + first.purgedSuppressed + first.purgedDeadLetter,
			).toBe(2);
			expect(first.backlog).toBe(1);
			expect(first.oldestActiveAgeSeconds).toBeGreaterThanOrEqual(10_799);

			const second = await push.maintain({
				now,
				retentionMs: 30 * 24 * 60 * 60 * 1_000,
				limit: 2,
			});
			expect(
				second.purgedDelivered +
					second.purgedSuppressed +
					second.purgedDeadLetter,
			).toBe(1);
		});

		async function insertDelivery(
			label: string,
			state: "pending" | "delivered" | "dead_letter",
			createdAt: Date,
		) {
			const sequence = magicLinkIds.length + 1;
			const hex = scopedHex(`delivery-${label}`);
			const magicLinkId = `ml_${hex}`;
			const jobId = `job_${hex}`;
			magicLinkIds.push(magicLinkId);
			const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1_000);
			const completedAt = new Date(createdAt.getTime() + 30 * 60 * 1_000);
			await sql`
				INSERT INTO user_magic_links (
					id, email, token_hash, expires_at, created_at
				) VALUES (
					${magicLinkId}, ${`ops-${sequence}-${suffix}@example.test`},
					${scopedHex(`token-${label}`).repeat(2)}, ${expiresAt}, ${createdAt}
				)
			`;
			await sql`
				INSERT INTO user_delivery_outbox (
					id, magic_link_id, kind, sealed_payload, token_expires_at,
					state, attempt_count, available_at, failure_code,
					created_at, updated_at, delivered_at, dead_lettered_at
				) VALUES (
					${jobId}, ${magicLinkId}, 'magic_link', 'v1.kid.aaa.bbb.ccc',
					${expiresAt}, ${state}, 1, ${createdAt},
					${state === "dead_letter" ? "attempts_exhausted" : null},
					${createdAt}, ${completedAt},
					${state === "delivered" ? completedAt : null},
					${state === "dead_letter" ? completedAt : null}
				)
			`;
		}

		async function insertPush(
			label: string,
			state: "pending" | "delivered" | "suppressed" | "dead_letter",
			createdAt: Date,
		) {
			const hex = scopedHex(`push-${label}`);
			const jobId = `pjob_${hex}`;
			pushJobIds.push(jobId);
			const completedAt = new Date(createdAt.getTime() + 30 * 60 * 1_000);
			await sql`
				INSERT INTO user_push_outbox (
					id, event_job_id, recipient_user_id, device_id,
					request_id, causation_request_id, sealed_payload, expires_at,
					state, attempt_count, available_at, outcome_code,
					created_at, updated_at, delivered_at, suppressed_at, dead_lettered_at
				) VALUES (
					${jobId}, ${`job_${hex}`}, ${`usr_${hex}`}, ${`dev_${hex}`},
					${`ops.request.${hex}`}, ${`ops.cause.${hex}`},
					'v1.kid.aaa.bbb.ccc', ${new Date(createdAt.getTime() + 60 * 60 * 1_000)},
					${state}, 1, ${createdAt},
					${state === "suppressed" ? "recipient_ineligible" : state === "dead_letter" ? "attempts_exhausted" : null},
					${createdAt}, ${completedAt},
					${state === "delivered" ? completedAt : null},
					${state === "suppressed" ? completedAt : null},
					${state === "dead_letter" ? completedAt : null}
				)
			`;
		}

		function scopedHex(label: string) {
			return new Bun.CryptoHasher("sha256")
				.update(`${suffix}:${label}`)
				.digest("hex")
				.slice(0, 32);
		}

		function deliveryJobIds() {
			return ["delivered-old", "dead-old", "delivered-recent", "pending"].map(
				(label) => `job_${scopedHex(`delivery-${label}`)}`,
			);
		}
	});
}

function daysAgo(now: Date, days: number) {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

function hoursAgo(now: Date, hours: number) {
	return new Date(now.getTime() - hours * 60 * 60 * 1_000);
}
