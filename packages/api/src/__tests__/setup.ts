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

/** Register a fresh group + admin member + event for testing */
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

  // Create an event (register doesn't create one automatically)
  const { status: eventStatus, data: eventData } = await api("/admin/event", {
    method: "POST",
    token: data.token,
    body: JSON.stringify({
      title: "Test Event",
      date_from: "2026-04-01",
      date_to: "2026-04-15",
    }),
  });

  if (eventStatus !== 200 && eventStatus !== 201) {
    throw new Error(`Failed to create test event: ${JSON.stringify(eventData)}`);
  }

  return {
    token: data.token,
    member: data.member,
    group: data.group,
    event: eventData.event,
  };
}

/** Clean up all test data — uses safe truncate cascade */
export async function cleanTestData() {
  try {
    await sql`DO $$ BEGIN
      TRUNCATE golf_score_history, golf_scores, golf_team_members, golf_teams,
               golf_player_handicaps, golf_rounds, golf_course_holes, golf_courses,
               participant_flights, participant_extras, participant_packages, participant_forms,
               flights, event_modules, messages, media, member_locations,
               events, group_members, groups
      CASCADE;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;`;
  } catch {
    // Table may not exist yet — safe to ignore
  }
}

/** Close DB connection — call only at the very end */
export async function closeDb() {
  await sql.end();
}

export { sql };
