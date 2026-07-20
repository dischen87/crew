import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const migrationUrl = new URL(
	"../migrations/0012_event_publish_readiness.sql",
	import.meta.url,
);
let sql: Sql;

beforeAll(() => {
	sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
});

afterAll(async () => {
	await sql.end();
});

describe("event publish readiness migration against PostgreSQL 17", () => {
	test("backfills legacy roots deterministically and rolls DDL back atomically", async () => {
		const migration = await readFile(migrationUrl, "utf8");
		const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
		const successSchema = `crew_publish_migration_success_${suffix}`;
		const rollbackSchema = `crew_publish_migration_rollback_${suffix}`;
		await sql.unsafe(`CREATE SCHEMA ${successSchema}`);
		await sql.unsafe(`CREATE SCHEMA ${rollbackSchema}`);
		try {
			await createLegacyRootTable(successSchema);
			await sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx.unsafe(`SET LOCAL search_path TO ${successSchema}`);
				await tx.unsafe(migration);
			});
			const [legacy] = await sql<
				{ templateId: string | null; templateVersion: number | null }[]
			>`
				SELECT template_id AS "templateId", template_version AS "templateVersion"
				FROM ${sql(successSchema)}.event_roots
				WHERE root_event_id = 'evt_legacy_publish01'
			`;
			expect(legacy).toEqual({ templateId: null, templateVersion: null });
			await expectSqlState(
				"23514",
				() =>
					sql`
					UPDATE ${sql(successSchema)}.event_roots
					SET template_id = 'team-event', template_version = NULL
					WHERE root_event_id = 'evt_legacy_publish01'
				`,
			);
			await sql`
				UPDATE ${sql(successSchema)}.event_roots
				SET template_id = 'team-event', template_version = 1
				WHERE root_event_id = 'evt_legacy_publish01'
			`;

			await createLegacyRootTable(rollbackSchema);
			await expect(
				sql.begin(async (transaction) => {
					const tx = transaction as unknown as Sql;
					await tx.unsafe(`SET LOCAL search_path TO ${rollbackSchema}`);
					await tx.unsafe(migration);
					throw new Error("force migration rollback proof");
				}),
			).rejects.toThrow("force migration rollback proof");
			const [rollbackProof] = await sql<{ columns: number }[]>`
				SELECT count(*)::int AS columns
				FROM information_schema.columns
				WHERE table_schema = ${rollbackSchema}
					AND table_name = 'event_roots'
					AND column_name IN ('template_id', 'template_version')
			`;
			expect(rollbackProof).toEqual({ columns: 0 });
		} finally {
			await sql.unsafe(`DROP SCHEMA ${successSchema} CASCADE`);
			await sql.unsafe(`DROP SCHEMA ${rollbackSchema} CASCADE`);
		}
	});
});

async function createLegacyRootTable(schema: string) {
	await sql.unsafe(`
		CREATE TABLE ${schema}.event_roots (root_event_id TEXT PRIMARY KEY);
		INSERT INTO ${schema}.event_roots (root_event_id)
		VALUES ('evt_legacy_publish01');
	`);
}

async function expectSqlState(code: string, work: () => PromiseLike<unknown>) {
	try {
		await work();
		throw new Error(`Expected PostgreSQL error ${code}`);
	} catch (error) {
		expect(error).toMatchObject({ code });
	}
}
