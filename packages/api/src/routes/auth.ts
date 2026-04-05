import { Hono } from "hono";
import { sql } from "../db/client";

const auth = new Hono();

/**
 * POST /join — Join a group by invite code.
 * Body: { invite_code: string, display_name: string }
 */
auth.post("/join", async (c) => {
  try {
    const body = await c.req.json<{ invite_code: string; display_name: string }>();

    if (!body.invite_code || !body.display_name) {
      return c.json({ error: "invite_code and display_name are required" }, 400);
    }

    const [group] = await sql`
      SELECT id, name, invite_code, cover_image, created_at
      FROM groups
      WHERE invite_code = ${body.invite_code.toUpperCase()}
    `;

    if (!group) {
      return c.json({ error: "Invalid invite code" }, 404);
    }

    const [member] = await sql`
      INSERT INTO group_members (group_id, display_name)
      VALUES (${group.id}, ${body.display_name})
      RETURNING id, group_id, display_name, avatar_url, avatar_emoji, is_admin, joined_at
    `;

    return c.json({ member, group }, 201);
  } catch (err) {
    console.error("POST /join error:", err);
    return c.json({ error: "Failed to join group" }, 500);
  }
});

export default auth;
