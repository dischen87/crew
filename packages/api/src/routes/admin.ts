import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";
import { searchCourses, getCourseDetail, toInternalCourse } from "../lib/golfCourseApi";

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

/**
 * POST /golf/course — Import a golf course with hole data.
 * Body: { name, location, country?, par_total, course_rating?, slope_rating?, holes: [{ hole_number, par, distance_m, handicap_index }] }
 */
admin.post("/golf/course", requireAdmin, async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      location?: string;
      country?: string;
      par_total: number;
      course_rating?: number;
      slope_rating?: number;
      latitude?: number;
      longitude?: number;
      holes: { hole_number: number; par: number; distance_m: number; handicap_index: number }[];
    }>();

    if (!body.name?.trim() || !body.par_total) {
      return c.json({ error: "name und par_total erforderlich" }, 400);
    }

    if (!body.holes || body.holes.length !== 18) {
      return c.json({ error: "Genau 18 Löcher erforderlich" }, 400);
    }

    // Validate par_total matches sum of hole pars
    const parSum = body.holes.reduce((sum, h) => sum + h.par, 0);
    if (parSum !== body.par_total) {
      return c.json({ error: `par_total (${body.par_total}) stimmt nicht mit Summe der Löcher (${parSum}) überein` }, 400);
    }

    // Transaction: create course + holes
    const [course] = await sql`
      INSERT INTO golf_courses (name, location, country, total_holes, par_total, course_rating, slope_rating, latitude, longitude, source)
      VALUES (${body.name.trim()}, ${body.location || null}, ${body.country || null}, 18,
              ${body.par_total}, ${body.course_rating || null}, ${body.slope_rating || null},
              ${body.latitude || null}, ${body.longitude || null}, 'admin')
      RETURNING id, name, par_total
    `;

    for (const hole of body.holes) {
      await sql`
        INSERT INTO golf_course_holes (course_id, hole_number, par, distance_m, handicap_index)
        VALUES (${course.id}, ${hole.hole_number}, ${hole.par}, ${hole.distance_m}, ${hole.handicap_index})
      `;
    }

    return c.json({ course }, 201);
  } catch (err) {
    console.error("POST /admin/golf/course error:", err);
    return c.json({ error: "Kurs-Import fehlgeschlagen" }, 500);
  }
});

/**
 * GET /golf/courses/search — Search golf courses worldwide via GolfCourseAPI.com.
 * Query: ?query=Montgomerie&country=TR&lat=36.86&lng=31.05&radius_km=50
 */
admin.get("/golf/courses/search", requireAdmin, async (c) => {
  try {
    const query = c.req.query("query");
    const country = c.req.query("country");
    const city = c.req.query("city");
    const lat = c.req.query("lat") ? parseFloat(c.req.query("lat")!) : undefined;
    const lng = c.req.query("lng") ? parseFloat(c.req.query("lng")!) : undefined;
    const radius_km = c.req.query("radius_km") ? parseFloat(c.req.query("radius_km")!) : undefined;

    const courses = await searchCourses({ query, country, city, lat, lng, radius_km, limit: 20 });
    return c.json({ courses });
  } catch (err: any) {
    console.error("GET /admin/golf/courses/search error:", err);
    return c.json({ error: err.message || "Suche fehlgeschlagen" }, 500);
  }
});

/**
 * POST /golf/courses/import/:externalId — Import a course from GolfCourseAPI.com into our DB.
 * Fetches course detail including scorecard, converts to internal format, saves.
 */
admin.post("/golf/courses/import/:externalId", requireAdmin, async (c) => {
  try {
    const externalId = c.req.param("externalId");

    // Check if already imported
    const [existing] = await sql`
      SELECT id, name FROM golf_courses WHERE external_id = ${externalId}
    `;
    if (existing) {
      return c.json({ course: existing, message: "Kurs bereits importiert" }, 200);
    }

    // Fetch from external API
    const externalCourse = await getCourseDetail(externalId);
    const internal = toInternalCourse(externalCourse);

    if (!internal) {
      return c.json({ error: "Kurs hat keine vollständigen Loch-Daten (18 Löcher benötigt)" }, 400);
    }

    // Save to DB
    const [course] = await sql`
      INSERT INTO golf_courses (name, location, country, total_holes, par_total, course_rating, slope_rating, latitude, longitude, external_id, source)
      VALUES (${internal.name}, ${internal.location}, ${internal.country}, 18,
              ${internal.par_total}, ${internal.course_rating}, ${internal.slope_rating},
              ${internal.latitude}, ${internal.longitude}, ${internal.external_id}, 'golfcourseapi')
      RETURNING id, name, par_total, location, country
    `;

    for (const hole of internal.holes) {
      await sql`
        INSERT INTO golf_course_holes (course_id, hole_number, par, distance_m, handicap_index)
        VALUES (${course.id}, ${hole.hole_number}, ${hole.par}, ${hole.distance_m}, ${hole.handicap_index})
      `;
    }

    return c.json({ course, holes_imported: internal.holes.length }, 201);
  } catch (err: any) {
    console.error("POST /admin/golf/courses/import error:", err);
    return c.json({ error: err.message || "Import fehlgeschlagen" }, 500);
  }
});

/**
 * POST /flights — Import a flight with passengers.
 * Body: { event_id, direction, airline, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, passenger_names: string[] }
 */
admin.post("/flights", requireAdmin, async (c) => {
  try {
    const member = getMember(c);
    const body = await c.req.json<{
      event_id: string;
      direction: string;
      airline: string;
      flight_number: string;
      departure_airport: string;
      arrival_airport: string;
      departure_time: string;
      arrival_time: string;
      passenger_names?: string[];
    }>();

    if (!body.event_id || !body.direction || !body.airline || !body.flight_number) {
      return c.json({ error: "event_id, direction, airline, flight_number erforderlich" }, 400);
    }

    const [flight] = await sql`
      INSERT INTO flights (event_id, direction, airline, flight_number, departure_airport, arrival_airport, departure_time, arrival_time)
      VALUES (${body.event_id}, ${body.direction}, ${body.airline}, ${body.flight_number},
              ${body.departure_airport}, ${body.arrival_airport}, ${body.departure_time}, ${body.arrival_time})
      RETURNING id
    `;

    // Link passengers by name
    let linked = 0;
    if (body.passenger_names?.length) {
      for (const name of body.passenger_names) {
        // Resolve: name → member_id → participant_form_id
        const [m] = await sql`
          SELECT gm.id AS member_id, pf.id AS form_id
          FROM group_members gm
          LEFT JOIN participant_forms pf ON pf.member_id = gm.id AND pf.event_id = ${body.event_id}
          WHERE gm.group_id = ${member.group_id}
            AND LOWER(TRIM(gm.display_name)) = LOWER(TRIM(${name}))
        `;

        if (m?.form_id) {
          await sql`
            INSERT INTO participant_flights (participant_id, flight_id)
            VALUES (${m.form_id}, ${flight.id})
            ON CONFLICT DO NOTHING
          `;
          linked++;
        }
      }
    }

    return c.json({ flight: { id: flight.id }, passengers_linked: linked }, 201);
  } catch (err) {
    console.error("POST /admin/flights error:", err);
    return c.json({ error: "Flug-Import fehlgeschlagen" }, 500);
  }
});

/**
 * POST /import — Bulk import courses, rounds, and flights for an event.
 * Body: { event_id, courses?: [...], rounds?: [...], flights?: [...] }
 */
admin.post("/import", requireAdmin, async (c) => {
  try {
    const member = getMember(c);
    const body = await c.req.json<{
      event_id: string;
      courses?: {
        name: string;
        location?: string;
        country?: string;
        par_total: number;
        course_rating?: number;
        slope_rating?: number;
        latitude?: number;
        longitude?: number;
        holes: { hole_number: number; par: number; distance_m: number; handicap_index: number }[];
      }[];
      rounds?: {
        course_name: string;
        format?: string;
        game_mode?: string;
        date: string;
        tee_time?: string;
        notes?: string;
      }[];
      flights?: {
        direction: string;
        airline: string;
        flight_number: string;
        departure_airport: string;
        arrival_airport: string;
        departure_time: string;
        arrival_time: string;
        passenger_names?: string[];
      }[];
    }>();

    if (!body.event_id) {
      return c.json({ error: "event_id erforderlich" }, 400);
    }

    // Verify event exists
    const [event] = await sql`SELECT id FROM events WHERE id = ${body.event_id}`;
    if (!event) return c.json({ error: "Event nicht gefunden" }, 404);

    const result = { courses: 0, rounds: 0, flights: 0 };

    // Import courses
    const courseNameToId: Record<string, string> = {};
    if (body.courses?.length) {
      for (const course of body.courses) {
        if (course.holes?.length !== 18) {
          return c.json({ error: `Kurs "${course.name}": genau 18 Löcher erforderlich` }, 400);
        }
        const [c_row] = await sql`
          INSERT INTO golf_courses (name, location, country, total_holes, par_total, course_rating, slope_rating, latitude, longitude, source)
          VALUES (${course.name}, ${course.location || null}, ${course.country || null}, 18,
                  ${course.par_total}, ${course.course_rating || null}, ${course.slope_rating || null},
                  ${course.latitude || null}, ${course.longitude || null}, 'admin')
          RETURNING id
        `;
        courseNameToId[course.name] = c_row.id;

        for (const hole of course.holes) {
          await sql`
            INSERT INTO golf_course_holes (course_id, hole_number, par, distance_m, handicap_index)
            VALUES (${c_row.id}, ${hole.hole_number}, ${hole.par}, ${hole.distance_m}, ${hole.handicap_index})
          `;
        }
        result.courses++;
      }
    }

    // Also resolve existing courses by name
    const existingCourses = await sql`SELECT id, name FROM golf_courses`;
    for (const ec of existingCourses) {
      if (!courseNameToId[ec.name]) courseNameToId[ec.name] = ec.id;
    }

    // Import rounds (reference courses by name)
    if (body.rounds?.length) {
      for (const round of body.rounds) {
        const courseId = courseNameToId[round.course_name];
        if (!courseId) {
          return c.json({ error: `Kurs "${round.course_name}" nicht gefunden` }, 400);
        }
        await sql`
          INSERT INTO golf_rounds (event_id, course_id, format, game_mode, date, tee_time, notes)
          VALUES (${body.event_id}, ${courseId}, ${round.format || "stableford"}, ${round.game_mode || "individual"},
                  ${round.date}, ${round.tee_time || null}, ${round.notes || null})
        `;
        result.rounds++;
      }
    }

    // Import flights
    if (body.flights?.length) {
      for (const flight of body.flights) {
        const [f] = await sql`
          INSERT INTO flights (event_id, direction, airline, flight_number, departure_airport, arrival_airport, departure_time, arrival_time)
          VALUES (${body.event_id}, ${flight.direction}, ${flight.airline}, ${flight.flight_number},
                  ${flight.departure_airport}, ${flight.arrival_airport}, ${flight.departure_time}, ${flight.arrival_time})
          RETURNING id
        `;

        if (flight.passenger_names?.length) {
          for (const name of flight.passenger_names) {
            const [m] = await sql`
              SELECT pf.id AS form_id
              FROM group_members gm
              LEFT JOIN participant_forms pf ON pf.member_id = gm.id AND pf.event_id = ${body.event_id}
              WHERE gm.group_id = ${member.group_id}
                AND LOWER(TRIM(gm.display_name)) = LOWER(TRIM(${name}))
            `;
            if (m?.form_id) {
              await sql`INSERT INTO participant_flights (participant_id, flight_id) VALUES (${m.form_id}, ${f.id}) ON CONFLICT DO NOTHING`;
            }
          }
        }
        result.flights++;
      }
    }

    return c.json({ imported: result }, 201);
  } catch (err) {
    console.error("POST /admin/import error:", err);
    return c.json({ error: "Bulk-Import fehlgeschlagen" }, 500);
  }
});

/**
 * POST /event/:id/module — Add a module to an event.
 * Body: { type: "billiards", config?: { format: "8-ball", points: { win: 3, loss: 0 } } }
 */
admin.post("/event/:id/module", requireAdmin, async (c) => {
  try {
    const eventId = c.req.param("id");
    const body = await c.req.json<{
      type: string;
      config?: Record<string, any>;
    }>();

    if (!body.type?.trim()) {
      return c.json({ error: "type erforderlich" }, 400);
    }

    // Check if module already exists for this event
    const [existing] = await sql`
      SELECT id FROM event_modules WHERE event_id = ${eventId} AND type = ${body.type}
    `;

    if (existing) {
      // Reactivate + update config
      const [mod] = await sql`
        UPDATE event_modules
        SET active = true, config = ${sql.json(body.config || {})}
        WHERE id = ${existing.id}
        RETURNING id, type, config, sort_order, active
      `;
      return c.json({ module: mod });
    }

    // Get next sort_order
    const [maxOrder] = await sql`
      SELECT COALESCE(MAX(sort_order), 0)::int AS max_order
      FROM event_modules WHERE event_id = ${eventId}
    `;

    const [mod] = await sql`
      INSERT INTO event_modules (event_id, type, config, sort_order, active)
      VALUES (${eventId}, ${body.type.trim()}, ${sql.json(body.config || {})}, ${maxOrder.max_order + 1}, true)
      RETURNING id, type, config, sort_order, active
    `;

    return c.json({ module: mod }, 201);
  } catch (err) {
    console.error("POST /admin/event/:id/module error:", err);
    return c.json({ error: "Modul-Erstellung fehlgeschlagen" }, 500);
  }
});

/**
 * DELETE /event/:id/module/:moduleId — Remove a module from an event.
 */
admin.delete("/event/:id/module/:moduleId", requireAdmin, async (c) => {
  try {
    const moduleId = c.req.param("moduleId");

    const [mod] = await sql`
      UPDATE event_modules SET active = false
      WHERE id = ${moduleId}
      RETURNING id, type, active
    `;

    if (!mod) return c.json({ error: "Modul nicht gefunden" }, 404);
    return c.json({ module: mod });
  } catch (err) {
    console.error("DELETE /admin/event/:id/module/:moduleId error:", err);
    return c.json({ error: "Modul-Entfernung fehlgeschlagen" }, 500);
  }
});

export default admin;
