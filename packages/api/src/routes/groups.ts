import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware } from "../middleware/auth";

const groups = new Hono();
groups.use("*", authMiddleware);

/**
 * GET /:id — Returns a group with its members and events.
 */
groups.get("/:id", async (c) => {
  try {
    const groupId = c.req.param("id");

    const [group] = await sql`
      SELECT id, name, invite_code, cover_image, created_at
      FROM groups
      WHERE id = ${groupId}
    `;

    if (!group) {
      return c.json({ error: "Group not found" }, 404);
    }

    const members = await sql`
      SELECT id, display_name, avatar_url, avatar_emoji, is_admin, joined_at
      FROM group_members
      WHERE group_id = ${groupId}
      ORDER BY joined_at ASC
    `;

    const events = await sql`
      SELECT id, title, type, date_from, date_to, location, cover_image, status, created_at
      FROM events
      WHERE group_id = ${groupId}
      ORDER BY date_from ASC
    `;

    return c.json({ ...group, members, events });
  } catch (err) {
    console.error("GET /groups/:id error:", err);
    return c.json({ error: "Failed to fetch group" }, 500);
  }
});

export default groups;
