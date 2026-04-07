import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware } from "../middleware/auth";

const flights = new Hono();
flights.use("*", authMiddleware);

/**
 * GET /event/:id — List all flights with passengers for an event.
 */
flights.get("/event/:id", async (c) => {
  try {
    const eventId = c.req.param("id");

    const flightList = await sql`
      SELECT f.id, f.event_id, f.direction, f.airline, f.flight_number,
             f.departure_airport, f.arrival_airport,
             f.departure_time, f.arrival_time, f.booking_ref
      FROM flights f
      WHERE f.event_id = ${eventId}
      ORDER BY f.direction ASC, f.departure_time ASC
    `;

    // Get passenger assignments
    const passengers = await sql`
      SELECT pf.flight_id, gm.id AS member_id, gm.display_name
      FROM participant_flights pf
      JOIN participant_forms form ON form.id = pf.participant_id
      JOIN group_members gm ON gm.id = form.member_id
      WHERE form.event_id = ${eventId}
    `;

    // Merge passengers into flights
    const result = flightList.map((f) => ({
      ...f,
      passengers: passengers
        .filter((p) => p.flight_id === f.id)
        .map((p) => ({ member_id: p.member_id, display_name: p.display_name })),
    }));

    return c.json({ flights: result });
  } catch (err) {
    console.error("GET /flights/event/:id error:", err);
    return c.json({ error: "Failed to fetch flights" }, 500);
  }
});

export default flights;
