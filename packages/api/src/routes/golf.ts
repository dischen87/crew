import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const golf = new Hono();
golf.use("*", authMiddleware);

/**
 * Calculate stableford points for a hole.
 */
function calculateStableford(strokes: number, par: number, strokesReceived: number): number {
  const netStrokes = strokes - strokesReceived;
  const diff = netStrokes - par;

  if (diff <= -3) return 5; // albatross or better
  if (diff === -2) return 4; // eagle
  if (diff === -1) return 3; // birdie
  if (diff === 0) return 2;  // par
  if (diff === 1) return 1;  // bogey
  return 0;                   // double bogey or worse
}

/**
 * Calculate strokes received on a specific hole based on playing handicap and hole handicap index.
 */
function strokesReceivedOnHole(playingHandicap: number, holeHandicapIndex: number): number {
  if (playingHandicap <= 0) return 0;
  const full = Math.floor(playingHandicap / 18);
  const remainder = playingHandicap % 18;
  return full + (holeHandicapIndex <= remainder ? 1 : 0);
}

/**
 * GET /event/:id — Golf screen data (rounds, leaderboard).
 */
golf.get("/event/:id", async (c) => {
  try {
    const eventId = c.req.param("id");
    const courseId = c.req.query("course_id");
    const courseFilter = courseId ? sql`AND course_id = ${courseId}` : sql``;

    const rounds = await sql`
      SELECT r.id, r.course_id, r.format, r.game_mode, r.date, r.tee_time, r.notes, r.tee_id,
             c.name AS course_name, c.par_total, c.location AS course_location,
             c.description AS course_description, c.website AS course_website
      FROM golf_rounds r
      LEFT JOIN golf_courses c ON c.id = r.course_id
      WHERE r.event_id = ${eventId}
      ORDER BY r.date ASC, r.tee_time ASC
    `;

    // Leaderboard: sum stableford points per member, optionally filtered by course
    const leaderboard = await sql`
      SELECT
        gm.id AS member_id,
        gm.display_name,
        gm.avatar_emoji,
        COALESCE(SUM(gs.stableford), 0)::int AS total_points,
        COUNT(DISTINCT gs.round_id)::int AS rounds_played,
        COALESCE(SUM(gs.strokes), 0)::int AS total_strokes
      FROM group_members gm
      LEFT JOIN golf_scores gs ON gs.member_id = gm.id
        AND gs.round_id IN (SELECT id FROM golf_rounds WHERE event_id = ${eventId} ${courseFilter})
      WHERE gm.group_id = (SELECT group_id FROM events WHERE id = ${eventId})
      GROUP BY gm.id, gm.display_name, gm.avatar_emoji
      ORDER BY total_points DESC
    `;

    // Count scores per round for progress indication
    const roundProgress = await sql`
      SELECT gs.round_id, COUNT(DISTINCT gs.member_id)::int AS players_scored
      FROM golf_scores gs
      JOIN golf_rounds gr ON gr.id = gs.round_id
      WHERE gr.event_id = ${eventId} ${courseFilter}
      GROUP BY gs.round_id
    `;

    const roundsWithProgress = rounds.map((r) => ({
      ...r,
      players_scored: roundProgress.find((rp) => rp.round_id === r.id)?.players_scored ?? 0,
    }));

    return c.json({ rounds: roundsWithProgress, leaderboard });
  } catch (err) {
    console.error("GET /golf/event/:id error:", err);
    return c.json({ error: "Failed to fetch golf data" }, 500);
  }
});

/**
 * GET /round/:id — Detailed round data with holes and all player scores.
 */
golf.get("/round/:id", async (c) => {
  try {
    const roundId = c.req.param("id");

    const [round] = await sql`
      SELECT r.id, r.event_id, r.course_id, r.format, r.game_mode, r.tee_id, r.date, r.tee_time, r.notes,
             c.name AS course_name, c.par_total, c.location AS course_location,
             c.course_rating, c.slope_rating, c.description AS course_description, c.image_url,
             t.name AS tee_name, t.color AS tee_color, t.length_meters AS tee_length,
             t.course_rating AS tee_cr, t.slope_rating AS tee_slope
      FROM golf_rounds r
      LEFT JOIN golf_courses c ON c.id = r.course_id
      LEFT JOIN golf_course_tees t ON t.id = r.tee_id
      WHERE r.id = ${roundId}
    `;

    if (!round) {
      return c.json({ error: "Round not found" }, 404);
    }

    // Get hole data for the course
    let holes = await sql`
      SELECT hole_number, par, distance_m, handicap_index, name, description
      FROM golf_course_holes
      WHERE course_id = ${round.course_id}
      ORDER BY hole_number ASC
    `;

    // If round has a specific tee, merge tee distances
    if (round.tee_id) {
      const teeDistances = await sql`
        SELECT hole_number, distance_m
        FROM golf_tee_hole_distances
        WHERE tee_id = ${round.tee_id}
      `;
      if (teeDistances.length > 0) {
        holes = holes.map((h: any) => {
          const td = teeDistances.find((t: any) => t.hole_number === h.hole_number);
          return { ...h, distance_m: td?.distance_m || h.distance_m };
        });
      }
    }

    // Get available tees for this course
    const tees = await sql`
      SELECT id, name, color, course_rating, slope_rating, length_meters
      FROM golf_course_tees WHERE course_id = ${round.course_id}
      ORDER BY length_meters DESC NULLS LAST
    `;

    // Get all scores for this round
    const scores = await sql`
      SELECT gs.member_id, gs.hole, gs.strokes, gs.putts, gs.net_score, gs.stableford,
             gm.display_name
      FROM golf_scores gs
      LEFT JOIN group_members gm ON gm.id = gs.member_id
      WHERE gs.round_id = ${roundId}
      ORDER BY gm.display_name ASC, gs.hole ASC
    `;

    // Get player handicaps for this event
    const handicaps = await sql`
      SELECT gph.member_id, gph.handicap, gm.display_name
      FROM golf_player_handicaps gph
      LEFT JOIN group_members gm ON gm.id = gph.member_id
      WHERE gph.event_id = ${round.event_id}
    `;

    // Get all members in the group
    const members = await sql`
      SELECT gm.id, gm.display_name, gm.avatar_emoji
      FROM group_members gm
      WHERE gm.group_id = (SELECT group_id FROM events WHERE id = ${round.event_id})
      ORDER BY gm.display_name ASC
    `;

    return c.json({ round, holes, scores, handicaps, members, tees });
  } catch (err) {
    console.error("GET /golf/round/:id error:", err);
    return c.json({ error: "Failed to fetch round details" }, 500);
  }
});

/**
 * GET /courses/nearby — All courses with coordinates for GPS proximity detection.
 */
golf.get("/courses/nearby", async (c) => {
  try {
    const courses = await sql`
      SELECT id, name, latitude, longitude
      FROM golf_courses
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `;
    return c.json({ courses });
  } catch (err) {
    console.error("GET /courses/nearby error:", err);
    return c.json({ courses: [] });
  }
});

/**
 * GET /course/:id — Course detail with description and all holes.
 */
golf.get("/course/:id", async (c) => {
  try {
    const courseId = c.req.param("id");
    const [course] = await sql`
      SELECT id, name, location, country, total_holes, par_total, course_rating,
             slope_rating, length_meters, description, website
      FROM golf_courses WHERE id = ${courseId}
    `;
    if (!course) return c.json({ error: "Course not found" }, 404);

    const holes = await sql`
      SELECT hole_number, par, distance_m, handicap_index, name, description
      FROM golf_course_holes WHERE course_id = ${courseId}
      ORDER BY hole_number ASC
    `;

    return c.json({ course, holes });
  } catch (err) {
    console.error("GET /golf/course/:id error:", err);
    return c.json({ error: "Failed to fetch course" }, 500);
  }
});

/**
 * GET /handicap/:eventId — Get my handicap for this event.
 */
golf.get("/handicap/:eventId", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const member = getMember(c);
    const [row] = await sql`
      SELECT handicap FROM golf_player_handicaps
      WHERE member_id = ${member.id} AND event_id = ${eventId}
    `;
    return c.json({ handicap: row?.handicap ?? null });
  } catch (err) {
    console.error("GET /golf/handicap/:eventId error:", err);
    return c.json({ error: "Failed to fetch handicap" }, 500);
  }
});

/**
 * POST /handicap/:eventId — Set my handicap.
 * Body: { handicap: number }
 */
golf.post("/handicap/:eventId", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const member = getMember(c);
    const body = await c.req.json<{ handicap: number }>();

    if (body.handicap === undefined || body.handicap === null) {
      return c.json({ error: "handicap is required" }, 400);
    }

    const [row] = await sql`
      INSERT INTO golf_player_handicaps (member_id, event_id, handicap)
      VALUES (${member.id}, ${eventId}, ${body.handicap})
      ON CONFLICT (member_id, event_id)
      DO UPDATE SET handicap = ${body.handicap}
      RETURNING member_id, event_id, handicap
    `;
    return c.json(row);
  } catch (err) {
    console.error("POST /golf/handicap/:eventId error:", err);
    return c.json({ error: "Failed to save handicap" }, 500);
  }
});

/**
 * POST /event/:id/score — Submit score for a hole.
 * Body: { round_id, hole, strokes, putts? }
 */
golf.post("/event/:id/score", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    const body = await c.req.json<{
      round_id: string;
      hole: number;
      strokes: number;
      putts?: number;
    }>();

    if (!body.round_id || !body.hole || !body.strokes) {
      return c.json({ error: "round_id, hole, and strokes are required" }, 400);
    }

    // Get round info and course hole data
    const [round] = await sql`
      SELECT r.id, r.course_id, r.event_id
      FROM golf_rounds r
      WHERE r.id = ${body.round_id} AND r.event_id = ${eventId}
    `;

    if (!round) {
      return c.json({ error: "Round not found" }, 404);
    }

    const [holeData] = await sql`
      SELECT par, handicap_index
      FROM golf_course_holes
      WHERE course_id = ${round.course_id} AND hole_number = ${body.hole}
    `;

    if (!holeData) {
      return c.json({ error: "Hole data not found" }, 404);
    }

    // Get player handicap
    const [handicapRow] = await sql`
      SELECT handicap FROM golf_player_handicaps
      WHERE member_id = ${member.id} AND event_id = ${eventId}
    `;

    const playingHandicap = Math.round(handicapRow?.handicap ?? 0);
    const received = strokesReceivedOnHole(playingHandicap, holeData.handicap_index);
    const netScore = body.strokes - received;
    const stableford = calculateStableford(body.strokes, holeData.par, received);

    const [score] = await sql`
      INSERT INTO golf_scores (round_id, member_id, hole, strokes, putts, net_score, stableford)
      VALUES (
        ${body.round_id},
        ${member.id},
        ${body.hole},
        ${body.strokes},
        ${body.putts ?? null},
        ${netScore},
        ${stableford}
      )
      ON CONFLICT (round_id, member_id, hole)
      DO UPDATE SET
        strokes = ${body.strokes},
        putts = ${body.putts ?? null},
        net_score = ${netScore},
        stableford = ${stableford}
      RETURNING round_id, member_id, hole, strokes, putts, net_score, stableford
    `;

    // Post activity message to group chat
    try {
      const [roundInfo] = await sql`
        SELECT c.name AS course_name FROM golf_rounds r
        LEFT JOIN golf_courses c ON c.id = r.course_id
        WHERE r.id = ${body.round_id}
      `;
      const courseName = roundInfo?.course_name || "Unbekannt";
      const diff = body.strokes - holeData.par;
      const label = diff <= -2 ? "Eagle 🦅" : diff === -1 ? "Birdie 🐦" : diff === 0 ? "Par" : diff === 1 ? "Bogey" : `+${diff}`;
      const emoji = stableford >= 3 ? "🔥" : stableford === 2 ? "✅" : "";
      const chatContent = `⛳ Loch ${body.hole} (${courseName}): ${body.strokes} Schläge (${label}) → ${stableford} Pkt ${emoji}`;

      const [groupId] = await sql`SELECT group_id FROM events WHERE id = ${eventId}`;
      if (groupId) {
        await sql`
          INSERT INTO messages (group_id, sender_id, content, type, event_id)
          VALUES (${groupId.group_id}, ${member.id}, ${chatContent}, 'activity', ${eventId})
        `;
      }
    } catch (chatErr) {
      console.error("Failed to post score activity to chat:", chatErr);
    }

    return c.json({ score });
  } catch (err) {
    console.error("POST /golf/event/:id/score error:", err);
    return c.json({ error: "Failed to submit score" }, 500);
  }
});

/**
 * DELETE /event/:id/score — Delete a score for a hole.
 * Body: { round_id, hole }
 */
golf.delete("/event/:id/score", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    const body = await c.req.json<{ round_id: string; hole: number }>();

    if (!body.round_id || !body.hole) {
      return c.json({ error: "round_id and hole are required" }, 400);
    }

    // Verify round belongs to this event
    const [round] = await sql`
      SELECT id FROM golf_rounds WHERE id = ${body.round_id} AND event_id = ${eventId}
    `;
    if (!round) {
      return c.json({ error: "Round not found" }, 404);
    }

    await sql`
      DELETE FROM golf_scores
      WHERE round_id = ${body.round_id} AND member_id = ${member.id} AND hole = ${body.hole}
    `;

    return c.json({ success: true });
  } catch (err) {
    console.error("DELETE /golf/event/:id/score error:", err);
    return c.json({ error: "Failed to delete score" }, 500);
  }
});

/**
 * POST /event/:id/round — Create a new round (admin).
 * Body: { course_id, format?, game_mode?, date?, tee_time?, tee_id?, teams? }
 */
golf.post("/event/:id/round", async (c) => {
  try {
    const eventId = c.req.param("id");
    const member = getMember(c);
    if (!member.is_admin) return c.json({ error: "Admin required" }, 403);

    const body = await c.req.json<{
      course_id: string;
      format?: string;
      game_mode?: string;
      date?: string;
      tee_time?: string;
      tee_id?: string;
      notes?: string;
      teams?: { name: string; color?: string; member_ids: string[] }[];
    }>();

    if (!body.course_id) return c.json({ error: "course_id required" }, 400);

    const [round] = await sql`
      INSERT INTO golf_rounds (event_id, course_id, format, game_mode, date, tee_time, tee_id, notes)
      VALUES (
        ${eventId},
        ${body.course_id},
        ${body.format || "stableford"},
        ${body.game_mode || "individual"},
        ${body.date || null},
        ${body.tee_time || null},
        ${body.tee_id || null},
        ${body.notes || null}
      )
      RETURNING *
    `;

    // Create teams if provided
    if (body.teams && body.teams.length > 0) {
      for (const team of body.teams) {
        const [t] = await sql`
          INSERT INTO golf_teams (round_id, name, color)
          VALUES (${round.id}, ${team.name}, ${team.color || null})
          RETURNING id
        `;
        for (const mid of team.member_ids) {
          await sql`INSERT INTO golf_team_members (team_id, member_id) VALUES (${t.id}, ${mid})`;
        }
      }
    }

    return c.json({ round }, 201);
  } catch (err) {
    console.error("POST /golf/event/:id/round error:", err);
    return c.json({ error: "Failed to create round" }, 500);
  }
});

/**
 * PUT /round/:id/teams — Update teams/flights for a round (admin).
 * Replaces all existing teams with the provided ones.
 * Body: { teams: [{ name, color?, member_ids[] }] }
 */
golf.put("/round/:id/teams", async (c) => {
  try {
    const roundId = c.req.param("id");
    const member = getMember(c);
    if (!member.is_admin) return c.json({ error: "Admin required" }, 403);

    const { teams } = await c.req.json<{
      teams: { name: string; color?: string; member_ids: string[] }[];
    }>();

    // Delete existing teams and members for this round
    const existingTeams = await sql`SELECT id FROM golf_teams WHERE round_id = ${roundId}`;
    if (existingTeams.length > 0) {
      const teamIds = existingTeams.map((t: any) => t.id);
      await sql`DELETE FROM golf_team_members WHERE team_id = ANY(${teamIds})`;
      await sql`DELETE FROM golf_teams WHERE round_id = ${roundId}`;
    }

    // Create new teams
    const created = [];
    for (const team of teams || []) {
      if (!team.member_ids || team.member_ids.length === 0) continue;
      const [t] = await sql`
        INSERT INTO golf_teams (round_id, name, color)
        VALUES (${roundId}, ${team.name}, ${team.color || null})
        RETURNING id, name, color
      `;
      for (const mid of team.member_ids) {
        await sql`INSERT INTO golf_team_members (team_id, member_id) VALUES (${t.id}, ${mid})`;
      }
      created.push({ ...t, members: team.member_ids });
    }

    return c.json({ teams: created });
  } catch (err) {
    console.error("PUT /golf/round/:id/teams error:", err);
    return c.json({ error: "Failed to update teams" }, 500);
  }
});

/**
 * GET /round/:id/teams — Get teams for a round.
 */
golf.get("/round/:id/teams", async (c) => {
  try {
    const roundId = c.req.param("id");
    const teams = await sql`
      SELECT t.id, t.name, t.color,
        COALESCE(json_agg(json_build_object(
          'member_id', gtm.member_id,
          'display_name', gm.display_name,
          'avatar_emoji', gm.avatar_emoji
        )) FILTER (WHERE gtm.member_id IS NOT NULL), '[]') AS members
      FROM golf_teams t
      LEFT JOIN golf_team_members gtm ON gtm.team_id = t.id
      LEFT JOIN group_members gm ON gm.id = gtm.member_id
      WHERE t.round_id = ${roundId}
      GROUP BY t.id, t.name, t.color
    `;
    return c.json({ teams });
  } catch (err) {
    console.error("GET /golf/round/:id/teams error:", err);
    return c.json({ error: "Failed to fetch teams" }, 500);
  }
});

/**
 * GET /course/:id/tees — Get available tees for a course.
 */
golf.get("/course/:id/tees", async (c) => {
  try {
    const courseId = c.req.param("id");
    const tees = await sql`
      SELECT id, name, color, course_rating, slope_rating, length_meters
      FROM golf_course_tees WHERE course_id = ${courseId}
      ORDER BY length_meters DESC NULLS LAST
    `;
    return c.json({ tees });
  } catch (err) {
    console.error("GET /golf/course/:id/tees error:", err);
    return c.json({ error: "Failed to fetch tees" }, 500);
  }
});

/**
 * GET /course/:id/holes — Get hole data, optionally for a specific tee.
 * Query: ?tee_id=uuid
 */
golf.get("/course/:id/holes", async (c) => {
  try {
    const courseId = c.req.param("id");
    const teeId = c.req.query("tee_id");

    const holes = await sql`
      SELECT hole_number, par, distance_m, handicap_index, name, description
      FROM golf_course_holes WHERE course_id = ${courseId}
      ORDER BY hole_number ASC
    `;

    if (teeId) {
      const teeDistances = await sql`
        SELECT hole_number, distance_m FROM golf_tee_hole_distances
        WHERE tee_id = ${teeId} ORDER BY hole_number ASC
      `;
      const merged = holes.map((h: any) => ({
        ...h,
        tee_distance_m: teeDistances.find((td: any) => td.hole_number === h.hole_number)?.distance_m || h.distance_m,
      }));
      return c.json({ holes: merged });
    }

    return c.json({ holes });
  } catch (err) {
    console.error("GET /golf/course/:id/holes error:", err);
    return c.json({ error: "Failed to fetch holes" }, 500);
  }
});

export default golf;
