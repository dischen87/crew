import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const locations = new Hono();
locations.use("*", authMiddleware);

/**
 * GET /:eventId — Get all shared locations for this event's group.
 */
locations.get("/:eventId", async (c) => {
  try {
    const eventId = c.req.param("eventId");

    const locs = await sql`
      SELECT ml.member_id, ml.lat, ml.lng, ml.updated_at,
             gm.display_name, gm.avatar_emoji
      FROM member_locations ml
      JOIN group_members gm ON gm.id = ml.member_id
      WHERE gm.group_id = (SELECT group_id FROM events WHERE id = ${eventId})
      ORDER BY ml.updated_at DESC
    `;

    return c.json({ locations: locs });
  } catch (err) {
    console.error("GET /locations/:eventId error:", err);
    return c.json({ locations: [] });
  }
});

/**
 * POST /:eventId — Share my location.
 * Body: { lat: number, lng: number }
 */
locations.post("/:eventId", async (c) => {
  try {
    const member = getMember(c);
    const body = await c.req.json<{ lat: number; lng: number }>();

    if (!body.lat || !body.lng) {
      return c.json({ error: "lat and lng required" }, 400);
    }

    const [loc] = await sql`
      INSERT INTO member_locations (member_id, lat, lng, updated_at)
      VALUES (${member.id}, ${body.lat}, ${body.lng}, NOW())
      ON CONFLICT (member_id)
      DO UPDATE SET lat = ${body.lat}, lng = ${body.lng}, updated_at = NOW()
      RETURNING member_id, lat, lng, updated_at
    `;

    return c.json(loc);
  } catch (err) {
    console.error("POST /locations/:eventId error:", err);
    return c.json({ error: "Failed to share location" }, 500);
  }
});

export default locations;
