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
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS image_url TEXT`;
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS website TEXT`;
  await sql`ALTER TABLE golf_course_holes ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`ALTER TABLE golf_course_holes ADD COLUMN IF NOT EXISTS name TEXT`;

  // === Phase: Golf Game Modes + Tees + Course Enrichment ===
  await sql`ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS game_mode TEXT DEFAULT 'individual'`;
  await sql`ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS tee_id UUID`;
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS latitude FLOAT`;
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS longitude FLOAT`;
  await sql`ALTER TABLE golf_courses ADD COLUMN IF NOT EXISTS external_id TEXT`;

  await sql`CREATE TABLE IF NOT EXISTS golf_course_tees (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id      UUID REFERENCES golf_courses(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    color          TEXT,
    course_rating  FLOAT,
    slope_rating   INT,
    length_meters  INT
  )`;

  await sql`CREATE TABLE IF NOT EXISTS golf_tee_hole_distances (
    tee_id      UUID REFERENCES golf_course_tees(id) ON DELETE CASCADE,
    hole_number INT,
    distance_m  INT,
    PRIMARY KEY (tee_id, hole_number)
  )`;

  await sql`CREATE TABLE IF NOT EXISTS golf_teams (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID REFERENCES golf_rounds(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    color    TEXT
  )`;

  await sql`CREATE TABLE IF NOT EXISTS golf_team_members (
    team_id   UUID REFERENCES golf_teams(id) ON DELETE CASCADE,
    member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, member_id)
  )`;

  // === Phase: Personal PIN for re-login ===
  await sql`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS pin_hash TEXT`;

  // === Phase: Tee preference on profile ===
  await sql`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS preferred_tee TEXT DEFAULT 'white'`;

  // === Phase: Chat Link Previews ===
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview JSONB`;

  // === Phase: Image Thumbnails ===
  await sql`ALTER TABLE media ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`;

  // === Phase: Generic Activity Matches (Billard, Darts, etc.) ===
  await sql`CREATE TABLE IF NOT EXISTS activity_matches (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
    module_id  UUID REFERENCES event_modules(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    player1_id UUID REFERENCES group_members(id),
    player2_id UUID REFERENCES group_members(id),
    winner_id  UUID REFERENCES group_members(id),
    score_p1   INT,
    score_p2   INT,
    status     TEXT DEFAULT 'open',
    date       TIMESTAMPTZ DEFAULT NOW(),
    notes      TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activity_matches_event ON activity_matches(event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activity_matches_module ON activity_matches(module_id)`;

  // === Phase: Round Status (open/closed) ===
  await sql`ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open'`;

  // === Phase: Score Audit Trail ===
  await sql`CREATE TABLE IF NOT EXISTS golf_score_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id   UUID NOT NULL,
    member_id  UUID NOT NULL,
    hole       INT NOT NULL,
    strokes    INT NOT NULL,
    putts      INT,
    net_score  INT,
    stableford INT,
    action     TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_score_history_round ON golf_score_history(round_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_score_history_member ON golf_score_history(member_id)`;

  // Data migrations
  console.log("Running data migrations...");
  await sql`UPDATE group_members SET is_admin = TRUE WHERE LOWER(TRIM(display_name)) = 'mathias graf'`;

  console.log("Schema setup complete.");

  await sql.end();
  process.exit(0);
}

setup().catch((err) => {
  console.error("Schema setup failed:", err);
  process.exit(1);
});
