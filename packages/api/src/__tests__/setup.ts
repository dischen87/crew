/**
 * Test helpers — spin up the Hono app with a test database.
 */
import { sql } from "../db/client";

const BASE_URL = "http://localhost:3000";

/** Helper to make API calls against the running app */
export async function api(path: string, options?: RequestInit & { token?: string }) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${BASE_URL}/v2${path}`, { ...options, headers });
  const data = await res.json();
  return { status: res.status, data };
}

/** Register a fresh group + admin member for testing */
export async function createTestGroup(groupName = "Test Group") {
  const { status, data } = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name: "Test Admin",
      password: "test1234",
      group_name: groupName,
      emoji: "🧪",
    }),
  });

  if (status !== 200 && status !== 201) {
    throw new Error(`Failed to create test group: ${JSON.stringify(data)}`);
  }

  return {
    token: data.token,
    member: data.member,
    group: data.group,
    event: data.event,
  };
}

/** Clean up all test data — uses safe truncate cascade */
export async function cleanTestData() {
  await sql`DO $$ BEGIN
    -- Truncate all tables in dependency-safe order
    TRUNCATE golf_score_history, golf_scores, golf_team_members, golf_teams,
             golf_player_handicaps, golf_rounds, golf_course_holes, golf_courses,
             participant_flights, participant_extras, participant_packages, participant_forms,
             flights, event_modules, messages, media, member_locations,
             events, group_members, groups
    CASCADE;
  EXCEPTION WHEN undefined_table THEN NULL;
  END $$;`;
}

export { sql };
