import { sql } from "./client";

async function setup() {
  const schemaPath = new URL("./schema.sql", import.meta.url).pathname;
  let schemaSql = await Bun.file(schemaPath).text();

  // Remove BEGIN/COMMIT since postgres.js handles transactions differently
  schemaSql = schemaSql.replace(/^BEGIN;/m, "").replace(/^COMMIT;/m, "");

  console.log("Running schema setup...");
  await sql.unsafe(schemaSql);
  console.log("Schema setup complete.");

  await sql.end();
  process.exit(0);
}

setup().catch((err) => {
  console.error("Schema setup failed:", err);
  process.exit(1);
});
