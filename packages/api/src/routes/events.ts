import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const events = new Hono();
events.use("*", authMiddleware);

/**
 * GET /:id — Returns event with modules (SDUI response).
 */
events.get("/:id", async (c) => {
  try {
    const eventId = c.req.param("id");

    const [event] = await sql`
      SELECT id, group_id, title, type, date_from, date_to, location, cover_image, status, created_at
      FROM events
      WHERE id = ${eventId}
    `;

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    const modules = await sql`
      SELECT id, type, config, sort_order, active
      FROM event_modules
      WHERE event_id = ${eventId} AND active = true
      ORDER BY sort_order ASC
    `;

    // Build SDUI screen sections from modules
    const sections = modules.map((mod) => ({
      module_id: mod.id,
      type: mod.type,
      config: mod.config,
      sort_order: mod.sort_order,
    }));

    return c.json({
      screen: {
        title: event.title,
        event,
        sections,
      },
    });
  } catch (err) {
    console.error("GET /events/:id error:", err);
    return c.json({ error: "Failed to fetch event" }, 500);
  }
});

/**
 * POST / — Create a new event.
 * Body: { group_id, title, type, location?, date_from?, date_to? }
 */
events.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      group_id: string;
      title: string;
      type: string;
      location?: string;
      date_from?: string;
      date_to?: string;
    }>();

    if (!body.group_id || !body.title || !body.type) {
      return c.json({ error: "group_id, title, and type are required" }, 400);
    }

    const [event] = await sql`
      INSERT INTO events (group_id, title, type, location, date_from, date_to)
      VALUES (
        ${body.group_id},
        ${body.title},
        ${body.type},
        ${body.location ?? null},
        ${body.date_from ?? null},
        ${body.date_to ?? null}
      )
      RETURNING id, group_id, title, type, date_from, date_to, location, cover_image, status, created_at
    `;

    return c.json({ event }, 201);
  } catch (err) {
    console.error("POST /events error:", err);
    return c.json({ error: "Failed to create event" }, 500);
  }
});

/**
 * GET /:id/form — Get participant form for the current member.
 */
events.get("/:id/form", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);

    let [form] = await sql`
      SELECT id, event_id, member_id, data, status, submitted_at
      FROM participant_forms
      WHERE event_id = ${eventId} AND member_id = ${member.id}
    `;

    // Auto-create a form entry if none exists
    if (!form) {
      [form] = await sql`
        INSERT INTO participant_forms (event_id, member_id)
        VALUES (${eventId}, ${member.id})
        RETURNING id, event_id, member_id, data, status, submitted_at
      `;
    }

    return c.json({ form });
  } catch (err) {
    console.error("GET /events/:id/form error:", err);
    return c.json({ error: "Failed to fetch form" }, 500);
  }
});

/**
 * POST /:id/form — Save participant form data.
 * Body: { data: object, submit?: boolean }
 */
events.post("/:id/form", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    const body = await c.req.json<{ data: Record<string, unknown>; submit?: boolean }>();

    if (!body.data) {
      return c.json({ error: "data is required" }, 400);
    }

    const status = body.submit ? "submitted" : "pending";
    const submittedAt = body.submit ? sql`NOW()` : null;

    // Check if form exists for this member + event
    const [existing] = await sql`
      SELECT id FROM participant_forms
      WHERE event_id = ${eventId} AND member_id = ${member.id}
    `;

    let form;
    if (existing) {
      [form] = await sql`
        UPDATE participant_forms
        SET data = ${sql.json(body.data)},
            status = ${status},
            submitted_at = ${submittedAt}
        WHERE id = ${existing.id}
        RETURNING id, event_id, member_id, data, status, submitted_at
      `;
    } else {
      [form] = await sql`
        INSERT INTO participant_forms (event_id, member_id, data, status, submitted_at)
        VALUES (${eventId}, ${member.id}, ${sql.json(body.data)}, ${status}, ${submittedAt})
        RETURNING id, event_id, member_id, data, status, submitted_at
      `;
    }

    return c.json({ form });
  } catch (err) {
    console.error("POST /events/:id/form error:", err);
    return c.json({ error: "Failed to save form" }, 500);
  }
});

/**
 * POST /:id/package — Select a package.
 * Body: { package_id: string }
 */
events.post("/:id/package", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    const body = await c.req.json<{ package_id: string }>();

    if (!body.package_id) {
      return c.json({ error: "package_id is required" }, 400);
    }

    // Ensure participant form exists
    let [form] = await sql`
      SELECT id FROM participant_forms
      WHERE event_id = ${eventId} AND member_id = ${member.id}
    `;

    if (!form) {
      [form] = await sql`
        INSERT INTO participant_forms (event_id, member_id)
        VALUES (${eventId}, ${member.id})
        RETURNING id
      `;
    }

    const [selection] = await sql`
      INSERT INTO participant_packages (participant_id, package_id)
      VALUES (${form.id}, ${body.package_id})
      ON CONFLICT (participant_id, package_id) DO NOTHING
      RETURNING participant_id, package_id, confirmed
    `;

    return c.json({ selection: selection ?? { participant_id: form.id, package_id: body.package_id } }, 201);
  } catch (err) {
    console.error("POST /events/:id/package error:", err);
    return c.json({ error: "Failed to select package" }, 500);
  }
});

/**
 * POST /:id/extras — Book an extra.
 * Body: { extra_id: string, quantity?: number }
 */
events.post("/:id/extras", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    const body = await c.req.json<{ extra_id: string; quantity?: number }>();

    if (!body.extra_id) {
      return c.json({ error: "extra_id is required" }, 400);
    }

    // Ensure participant form exists
    let [form] = await sql`
      SELECT id FROM participant_forms
      WHERE event_id = ${eventId} AND member_id = ${member.id}
    `;

    if (!form) {
      [form] = await sql`
        INSERT INTO participant_forms (event_id, member_id)
        VALUES (${eventId}, ${member.id})
        RETURNING id
      `;
    }

    const quantity = body.quantity ?? 1;

    const [booking] = await sql`
      INSERT INTO participant_extras (participant_id, extra_id, quantity)
      VALUES (${form.id}, ${body.extra_id}, ${quantity})
      ON CONFLICT (participant_id, extra_id)
      DO UPDATE SET quantity = ${quantity}
      RETURNING participant_id, extra_id, quantity, confirmed
    `;

    return c.json({ booking }, 201);
  } catch (err) {
    console.error("POST /events/:id/extras error:", err);
    return c.json({ error: "Failed to book extra" }, 500);
  }
});

export default events;
