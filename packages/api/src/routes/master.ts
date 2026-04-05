import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const master = new Hono();
master.use("*", authMiddleware);

/**
 * GET /event/:id — Event Master dashboard data.
 * Returns participant completion stats and module overview.
 */
master.get("/event/:id", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);

    if (!member.is_admin) {
      return c.json({ error: "Admin access required" }, 403);
    }

    // Event details
    const [event] = await sql`
      SELECT id, group_id, title, type, date_from, date_to, location, status, created_at
      FROM events
      WHERE id = ${eventId}
    `;

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    // Total members in group
    const [{ total_members }] = await sql`
      SELECT COUNT(*)::int AS total_members
      FROM group_members
      WHERE group_id = ${event.group_id}
    `;

    // Participant form stats
    const formStats = await sql`
      SELECT
        COUNT(*)::int AS total_forms,
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM participant_forms
      WHERE event_id = ${eventId}
    `;

    // Package selection stats
    const packageStats = await sql`
      SELECT
        tp.id, tp.name, tp.price_chf,
        COUNT(pp.participant_id)::int AS selected_count
      FROM trip_packages tp
      LEFT JOIN participant_packages pp ON pp.package_id = tp.id
      WHERE tp.event_id = ${eventId}
      GROUP BY tp.id, tp.name, tp.price_chf
      ORDER BY tp.sort_order ASC
    `;

    // Module overview
    const modules = await sql`
      SELECT id, type, config, sort_order, active
      FROM event_modules
      WHERE event_id = ${eventId}
      ORDER BY sort_order ASC
    `;

    return c.json({
      event,
      stats: {
        total_members,
        forms: formStats[0] ?? { total_forms: 0, submitted: 0, pending: 0 },
        packages: packageStats,
      },
      modules,
    });
  } catch (err) {
    console.error("GET /master/event/:id error:", err);
    return c.json({ error: "Failed to fetch dashboard data" }, 500);
  }
});

/**
 * POST /event/:id/complete — Mark event as completed.
 */
master.post("/event/:id/complete", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);

    if (!member.is_admin) {
      return c.json({ error: "Admin access required" }, 403);
    }

    const [event] = await sql`
      UPDATE events
      SET status = 'completed'
      WHERE id = ${eventId}
      RETURNING id, group_id, title, type, date_from, date_to, location, status, created_at
    `;

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    return c.json({ event });
  } catch (err) {
    console.error("POST /master/event/:id/complete error:", err);
    return c.json({ error: "Failed to complete event" }, 500);
  }
});

export default master;
