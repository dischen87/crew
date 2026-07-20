import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

const migrationsDirectory = fileURLToPath(
	new URL("../migrations/", import.meta.url),
);

export async function migrate(sql: Sql) {
	const files = (await readdir(migrationsDirectory))
		.filter((name) => name.endsWith(".sql"))
		.sort();

	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`
      SELECT pg_advisory_xact_lock(hashtextextended('crew:user-service:migrations', 0))
    `;
		await tx`
      CREATE TABLE IF NOT EXISTS user_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

		for (const name of files) {
			const source = await readFile(
				new URL(`../migrations/${name}`, import.meta.url),
				"utf8",
			);
			const checksum = createHash("sha256").update(source).digest("hex");
			const [applied] = await tx<{ checksum: string }[]>`
        SELECT checksum FROM user_schema_migrations WHERE name = ${name}
      `;
			if (applied) {
				if (applied.checksum !== checksum) {
					throw new Error(`Applied migration changed: ${name}`);
				}
				continue;
			}

			await tx.unsafe(source);
			await tx`
        INSERT INTO user_schema_migrations (name, checksum)
        VALUES (${name}, ${checksum})
      `;
		}
	});
}

if (import.meta.main) {
	const databaseUrl = Bun.env.USER_DATABASE_URL ?? Bun.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error("USER_DATABASE_URL or DATABASE_URL is required");
	}

	const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	try {
		await migrate(sql);
		console.info("User-service migrations applied");
	} finally {
		await sql.end();
	}
}
