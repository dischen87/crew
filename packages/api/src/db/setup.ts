import { sql } from "./client";

async function setup() {
  const schemaPath = new URL("./schema.sql", import.meta.url).pathname;
  let schemaSql = await Bun.file(schemaPath).text();

  // Remove BEGIN/COMMIT since postgres.js handles transactions differently
  schemaSql = schemaSql.replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, "");

  console.log("Running schema setup...");
  await sql.unsafe(schemaSql);

  // Migrations: add columns that may not exist yet
  console.log("Running migrations...");
  await sql`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  await sql`ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS notes TEXT`;

  console.log("Schema setup complete.");

  await sql.end();
  process.exit(0);
}

setup().catch((err) => {
  console.error("Schema setup failed:", err);
  process.exit(1);
});
