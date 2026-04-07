import { Hono } from "hono";
import { sql } from "../db/client";

const auth = new Hono();

/**
 * POST /login — Login with name + event password.
 * Body: { name: string, password: string }
 */
auth.post("/login", async (c) => {
  try {
    const body = await c.req.json<{ name: string; password: string; emoji?: string }>();

    if (!body.name || !body.password) {
      return c.json({ error: "Name und Passwort erforderlich" }, 400);
    }

    const eventPassword = process.env.EVENT_PASSWORD || "BelekGolf4ever";
    if (body.password !== eventPassword) {
      return c.json({ error: "Falsches Passwort" }, 401);
    }

    // Find member by display_name (case-insensitive, trimmed)
    const [member] = await sql`
      SELECT gm.id, gm.group_id, gm.display_name, gm.is_admin, gm.avatar_emoji
      FROM group_members gm
      WHERE LOWER(TRIM(gm.display_name)) = LOWER(TRIM(${body.name}))
    `;

    if (!member) {
      return c.json({
        error: "Name nicht gefunden. Verwende deinen exakten Namen (z.B. 'Mathias Graf')."
      }, 404);
    }

    // Update emoji if provided
    if (body.emoji) {
      await sql`
        UPDATE group_members SET avatar_emoji = ${body.emoji}
        WHERE id = ${member.id}
      `;
      member.avatar_emoji = body.emoji;
    }

    // Get group
    const [group] = await sql`
      SELECT id, name FROM groups WHERE id = ${member.group_id}
    `;

    // Get latest event
    const [event] = await sql`
      SELECT id, title, date_from, date_to, location, status
      FROM events
      WHERE group_id = ${member.group_id}
      ORDER BY date_from DESC
      LIMIT 1
    `;

    return c.json({
      token: member.id,
      member: {
        id: member.id,
        display_name: member.display_name,
        is_admin: member.is_admin,
        avatar_emoji: member.avatar_emoji,
      },
      group: group || null,
      event: event || null,
    });
  } catch (err) {
    console.error("POST /login error:", err);
    return c.json({ error: "Login fehlgeschlagen" }, 500);
  }
});

/**
 * POST /join — Join a group by invite code (legacy).
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
