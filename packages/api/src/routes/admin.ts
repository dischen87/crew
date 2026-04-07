import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const admin = new Hono();
admin.use("*", authMiddleware);

// Admin check middleware
async function requireAdmin(c: any, next: any) {
  const member = getMember(c);
  if (!member.is_admin) {
    return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  }
  await next();
}

/**
 * POST /event — Create a new event.
 */
admin.post("/event", requireAdmin, async (c) => {
  try {
    const member = getMember(c);
    const body = await c.req.json<{
      title: string;
      type?: string;
      date_from: string;
      date_to: string;
      location?: string;
    }>();

    if (!body.title?.trim() || !body.date_from || !body.date_to) {
      return c.json({ error: "Titel und Datum erforderlich" }, 400);
    }

    const [event] = await sql`
      INSERT INTO events (group_id, title, type, date_from, date_to, location, status)
      VALUES (
        ${member.group_id},
        ${body.title.trim()},
        ${body.type || "golf"},
        ${body.date_from},
        ${body.date_to},
        ${body.location || null},
        'active'
      )
      RETURNING id, title, type, date_from, date_to, location, status
    `;

    // Create default modules
    const modules = [
      { type: "golf", order: 1 },
      { type: "leaderboard", order: 2 },
      { type: "flights", order: 3 },
      { type: "chat", order: 4 },
      { type: "media", order: 5 },
    ];

    for (const mod of modules) {
      await sql`
        INSERT INTO event_modules (event_id, type, sort_order)
        VALUES (${event.id}, ${mod.type}, ${mod.order})
      `;
    }

    // Create participant form for all group members
    const members = await sql`
      SELECT id FROM group_members WHERE group_id = ${member.group_id}
    `;

    for (const m of members) {
      await sql`
        INSERT INTO participant_forms (event_id, member_id, status)
        VALUES (${event.id}, ${m.id}, 'pending')
      `;
    }

    return c.json({ event }, 201);
  } catch (err) {
    console.error("POST /admin/event error:", err);
    return c.json({ error: "Event-Erstellung fehlgeschlagen" }, 500);
  }
});

/**
 * GET /members — List all group members.
 */
admin.get("/members", requireAdmin, async (c) => {
  try {
    const member = getMember(c);

    const members = await sql`
      SELECT id, display_name, avatar_emoji, is_admin, joined_at
      FROM group_members
      WHERE group_id = ${member.group_id}
      ORDER BY joined_at ASC
    `;

    return c.json({ members });
  } catch (err) {
    console.error("GET /admin/members error:", err);
    return c.json({ error: "Failed to fetch members" }, 500);
  }
});

/**
 * GET /group — Get group info including invite code.
 */
admin.get("/group", requireAdmin, async (c) => {
  try {
    const member = getMember(c);

    const [group] = await sql`
      SELECT id, name, invite_code, created_at
      FROM groups WHERE id = ${member.group_id}
    `;

    const memberCount = await sql`
      SELECT COUNT(*)::int AS count FROM group_members WHERE group_id = ${member.group_id}
    `;

    return c.json({ group, member_count: memberCount[0].count });
  } catch (err) {
    console.error("GET /admin/group error:", err);
    return c.json({ error: "Failed to fetch group" }, 500);
  }
});

/**
 * DELETE /members/:id — Remove a member from the group.
 */
admin.delete("/members/:id", requireAdmin, async (c) => {
  try {
    const member = getMember(c);
    const targetId = c.req.param("id");

    if (targetId === member.id) {
      return c.json({ error: "Du kannst dich nicht selbst entfernen" }, 400);
    }

    await sql`
      DELETE FROM group_members
      WHERE id = ${targetId} AND group_id = ${member.group_id}
    `;

    return c.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/members/:id error:", err);
    return c.json({ error: "Failed to remove member" }, 500);
  }
});

export default admin;
