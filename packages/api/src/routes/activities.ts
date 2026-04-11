import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const activities = new Hono();
activities.use("*", authMiddleware);

/**
 * GET /event/:eventId — List all matches for an event, optionally filtered by type.
 * Query: ?type=billiards
 */
activities.get("/event/:eventId", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const type = c.req.query("type");

    const typeFilter = type ? sql`AND am.type = ${type}` : sql``;

    const matches = await sql`
      SELECT am.*,
             p1.display_name AS player1_name, p1.avatar_emoji AS player1_emoji,
             p2.display_name AS player2_name, p2.avatar_emoji AS player2_emoji,
             w.display_name AS winner_name
      FROM activity_matches am
      LEFT JOIN group_members p1 ON p1.id = am.player1_id
      LEFT JOIN group_members p2 ON p2.id = am.player2_id
      LEFT JOIN group_members w ON w.id = am.winner_id
      WHERE am.event_id = ${eventId} ${typeFilter}
      ORDER BY am.date DESC
    `;

    return c.json({ matches });
  } catch (err) {
    console.error("GET /activities/event/:eventId error:", err);
    return c.json({ error: "Failed to fetch matches" }, 500);
  }
});

/**
 * GET /:matchId — Single match detail.
 */
activities.get("/:matchId", async (c) => {
  try {
    const matchId = c.req.param("matchId");

    const [match] = await sql`
      SELECT am.*,
             p1.display_name AS player1_name, p1.avatar_emoji AS player1_emoji,
             p2.display_name AS player2_name, p2.avatar_emoji AS player2_emoji,
             w.display_name AS winner_name
      FROM activity_matches am
      LEFT JOIN group_members p1 ON p1.id = am.player1_id
      LEFT JOIN group_members p2 ON p2.id = am.player2_id
      LEFT JOIN group_members w ON w.id = am.winner_id
      WHERE am.id = ${matchId}
    `;

    if (!match) return c.json({ error: "Match not found" }, 404);
    return c.json({ match });
  } catch (err) {
    console.error("GET /activities/:matchId error:", err);
    return c.json({ error: "Failed to fetch match" }, 500);
  }
});

/**
 * POST /event/:eventId — Create a new match.
 * Body: { type, module_id?, player1_id, player2_id, notes? }
 */
activities.post("/event/:eventId", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const body = await c.req.json<{
      type: string;
      module_id?: string;
      player1_id: string;
      player2_id: string;
      notes?: string;
    }>();

    if (!body.type || !body.player1_id || !body.player2_id) {
      return c.json({ error: "type, player1_id, player2_id erforderlich" }, 400);
    }

    if (body.player1_id === body.player2_id) {
      return c.json({ error: "Ein Spieler kann nicht gegen sich selbst spielen" }, 400);
    }

    // If module_id not provided, find it from event_modules
    let moduleId = body.module_id;
    if (!moduleId) {
      const [mod] = await sql`
        SELECT id FROM event_modules
        WHERE event_id = ${eventId} AND type = ${body.type} AND active = true
        LIMIT 1
      `;
      moduleId = mod?.id || null;
    }

    const [match] = await sql`
      INSERT INTO activity_matches (event_id, module_id, type, player1_id, player2_id, notes)
      VALUES (${eventId}, ${moduleId}, ${body.type}, ${body.player1_id}, ${body.player2_id}, ${body.notes || null})
      RETURNING *
    `;

    return c.json({ match }, 201);
  } catch (err) {
    console.error("POST /activities/event/:eventId error:", err);
    return c.json({ error: "Failed to create match" }, 500);
  }
});

/**
 * POST /:matchId/result — Record match result.
 * Body: { winner_id, score_p1?, score_p2? }
 */
activities.post("/:matchId/result", async (c) => {
  try {
    const matchId = c.req.param("matchId");
    const body = await c.req.json<{
      winner_id: string;
      score_p1?: number;
      score_p2?: number;
    }>();

    if (!body.winner_id) {
      return c.json({ error: "winner_id erforderlich" }, 400);
    }

    // Verify match exists and winner is a participant
    const [match] = await sql`SELECT * FROM activity_matches WHERE id = ${matchId}`;
    if (!match) return c.json({ error: "Match not found" }, 404);

    if (body.winner_id !== match.player1_id && body.winner_id !== match.player2_id) {
      return c.json({ error: "Gewinner muss ein Teilnehmer des Matches sein" }, 400);
    }

    const [updated] = await sql`
      UPDATE activity_matches
      SET winner_id = ${body.winner_id},
          score_p1 = ${body.score_p1 ?? null},
          score_p2 = ${body.score_p2 ?? null},
          status = 'completed'
      WHERE id = ${matchId}
      RETURNING *
    `;

    return c.json({ match: updated });
  } catch (err) {
    console.error("POST /activities/:matchId/result error:", err);
    return c.json({ error: "Failed to record result" }, 500);
  }
});

/**
 * DELETE /:matchId — Delete a match.
 */
activities.delete("/:matchId", async (c) => {
  try {
    const matchId = c.req.param("matchId");
    await sql`DELETE FROM activity_matches WHERE id = ${matchId}`;
    return c.json({ ok: true });
  } catch (err) {
    console.error("DELETE /activities/:matchId error:", err);
    return c.json({ error: "Failed to delete match" }, 500);
  }
});

/**
 * GET /event/:eventId/leaderboard — Activity leaderboard.
 * Query: ?type=billiards
 * Points are calculated from event_modules.config.points (win/loss).
 */
activities.get("/event/:eventId/leaderboard", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const type = c.req.query("type");

    if (!type) return c.json({ error: "type Parameter erforderlich" }, 400);

    // Get point config from module
    const [mod] = await sql`
      SELECT config FROM event_modules
      WHERE event_id = ${eventId} AND type = ${type} AND active = true
      LIMIT 1
    `;

    const pointsConfig = mod?.config?.points || { win: 3, loss: 0 };
    const winPoints = pointsConfig.win ?? 3;
    const lossPoints = pointsConfig.loss ?? 0;

    // Calculate standings
    const standings = await sql`
      WITH player_stats AS (
        SELECT
          gm.id AS member_id,
          gm.display_name,
          gm.avatar_emoji,
          COUNT(*) FILTER (WHERE am.status = 'completed' AND am.winner_id = gm.id)::int AS wins,
          COUNT(*) FILTER (WHERE am.status = 'completed' AND am.winner_id IS NOT NULL AND am.winner_id != gm.id)::int AS losses,
          COUNT(*) FILTER (WHERE am.status = 'completed')::int AS played
        FROM group_members gm
        LEFT JOIN activity_matches am ON (am.player1_id = gm.id OR am.player2_id = gm.id)
          AND am.event_id = ${eventId} AND am.type = ${type}
        WHERE gm.group_id = (SELECT group_id FROM events WHERE id = ${eventId})
        GROUP BY gm.id, gm.display_name, gm.avatar_emoji
      )
      SELECT *,
        (wins * ${winPoints} + losses * ${lossPoints})::int AS total_points
      FROM player_stats
      WHERE played > 0
      ORDER BY total_points DESC, wins DESC
    `;

    return c.json({ leaderboard: standings, points_config: pointsConfig });
  } catch (err) {
    console.error("GET /activities/event/:eventId/leaderboard error:", err);
    return c.json({ error: "Failed to fetch leaderboard" }, 500);
  }
});

export default activities;
