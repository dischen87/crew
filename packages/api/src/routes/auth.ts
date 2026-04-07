import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const auth = new Hono();

/**
 * POST /register — Create a new group + become admin.
 * Body: { name: string, password: string, emoji?: string, group_name: string }
 */
auth.post("/register", async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      password: string;
      emoji?: string;
      group_name: string;
    }>();

    if (!body.name?.trim() || !body.password || !body.group_name?.trim()) {
      return c.json({ error: "Name, Passwort und Gruppenname erforderlich" }, 400);
    }

    if (body.password.length < 4) {
      return c.json({ error: "Passwort muss mindestens 4 Zeichen haben" }, 400);
    }

    // Generate invite code (6 chars uppercase)
    const inviteCode = body.group_name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4) + Math.random().toString(36).substring(2, 4).toUpperCase();

    // Create group
    const [group] = await sql`
      INSERT INTO groups (name, invite_code)
      VALUES (${body.group_name.trim()}, ${inviteCode})
      RETURNING id, name, invite_code
    `;

    // Hash password
    const passwordHash = await Bun.password.hash(body.password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    // Create admin member
    const [member] = await sql`
      INSERT INTO group_members (group_id, display_name, password_hash, avatar_emoji, is_admin)
      VALUES (${group.id}, ${body.name.trim()}, ${passwordHash}, ${body.emoji || "🏌️"}, TRUE)
      RETURNING id, group_id, display_name, is_admin, avatar_emoji
    `;

    return c.json({
      token: member.id,
      member: {
        id: member.id,
        display_name: member.display_name,
        is_admin: member.is_admin,
        avatar_emoji: member.avatar_emoji,
      },
      group: {
        id: group.id,
        name: group.name,
        invite_code: group.invite_code,
      },
      event: null,
    }, 201);
  } catch (err: any) {
    if (err?.code === "23505" && err?.constraint_name?.includes("invite_code")) {
      return c.json({ error: "Gruppenname bereits vergeben, bitte anderen wählen" }, 409);
    }
    console.error("POST /register error:", err);
    return c.json({ error: "Registrierung fehlgeschlagen" }, 500);
  }
});

/**
 * POST /join — Join a group by invite code.
 * Body: { invite_code: string, name: string, password: string, emoji?: string }
 */
auth.post("/join", async (c) => {
  try {
    const body = await c.req.json<{
      invite_code: string;
      name: string;
      password: string;
      emoji?: string;
    }>();

    if (!body.invite_code?.trim() || !body.name?.trim() || !body.password) {
      return c.json({ error: "Invite-Code, Name und Passwort erforderlich" }, 400);
    }

    if (body.password.length < 4) {
      return c.json({ error: "Passwort muss mindestens 4 Zeichen haben" }, 400);
    }

    // Find group by invite code
    const [group] = await sql`
      SELECT id, name, invite_code FROM groups
      WHERE UPPER(TRIM(invite_code)) = UPPER(TRIM(${body.invite_code}))
    `;

    if (!group) {
      return c.json({ error: "Ungültiger Invite-Code" }, 404);
    }

    // Check if name already taken in this group
    const [existing] = await sql`
      SELECT id FROM group_members
      WHERE group_id = ${group.id}
        AND LOWER(TRIM(display_name)) = LOWER(TRIM(${body.name}))
    `;

    if (existing) {
      return c.json({ error: "Dieser Name ist in der Gruppe bereits vergeben" }, 409);
    }

    // Hash password
    const passwordHash = await Bun.password.hash(body.password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    // Create member
    const [member] = await sql`
      INSERT INTO group_members (group_id, display_name, password_hash, avatar_emoji, is_admin)
      VALUES (${group.id}, ${body.name.trim()}, ${passwordHash}, ${body.emoji || "🏌️"}, FALSE)
      RETURNING id, group_id, display_name, is_admin, avatar_emoji
    `;

    // Get latest event
    const [event] = await sql`
      SELECT id, title, date_from, date_to, location, status
      FROM events WHERE group_id = ${group.id}
      ORDER BY date_from DESC LIMIT 1
    `;

    return c.json({
      token: member.id,
      member: {
        id: member.id,
        display_name: member.display_name,
        is_admin: member.is_admin,
        avatar_emoji: member.avatar_emoji,
      },
      group: { id: group.id, name: group.name },
      event: event || null,
    }, 201);
  } catch (err) {
    console.error("POST /join error:", err);
    return c.json({ error: "Beitritt fehlgeschlagen" }, 500);
  }
});

/**
 * POST /login — Login with name + password.
 * Body: { name: string, password: string }
 */
auth.post("/login", async (c) => {
  try {
    const body = await c.req.json<{ name: string; password: string }>();

    if (!body.name?.trim() || !body.password) {
      return c.json({ error: "Name und Passwort erforderlich" }, 400);
    }

    // Find member by display_name (case-insensitive)
    const [member] = await sql`
      SELECT gm.id, gm.group_id, gm.display_name, gm.is_admin, gm.avatar_emoji, gm.password_hash
      FROM group_members gm
      WHERE LOWER(TRIM(gm.display_name)) = LOWER(TRIM(${body.name}))
    `;

    if (!member) {
      return c.json({ error: "Name nicht gefunden" }, 404);
    }

    // Verify password
    if (member.password_hash) {
      const valid = await Bun.password.verify(body.password, member.password_hash);
      if (!valid) {
        return c.json({ error: "Falsches Passwort" }, 401);
      }
    } else {
      // Legacy: accept event password for members without password_hash
      const eventPassword = process.env.EVENT_PASSWORD || "BelekGolf4ever";
      if (body.password !== eventPassword) {
        return c.json({ error: "Falsches Passwort" }, 401);
      }
    }

    // Get group
    const [group] = await sql`
      SELECT id, name FROM groups WHERE id = ${member.group_id}
    `;

    // Get latest event
    const [event] = await sql`
      SELECT id, title, date_from, date_to, location, status
      FROM events WHERE group_id = ${member.group_id}
      ORDER BY date_from DESC LIMIT 1
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
 * PUT /profile — Update profile (emoji, name).
 */
auth.put("/profile", authMiddleware, async (c) => {
  try {
    const member = getMember(c);
    const body = await c.req.json<{ avatar_emoji?: string; display_name?: string }>();

    if (body.avatar_emoji) {
      await sql`UPDATE group_members SET avatar_emoji = ${body.avatar_emoji} WHERE id = ${member.id}`;
    }
    if (body.display_name?.trim()) {
      await sql`UPDATE group_members SET display_name = ${body.display_name.trim()} WHERE id = ${member.id}`;
    }

    return c.json({ ok: true });
  } catch (err) {
    console.error("PUT /profile error:", err);
    return c.json({ error: "Update failed" }, 500);
  }
});

export default auth;
