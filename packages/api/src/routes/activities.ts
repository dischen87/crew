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

    // Auto-advance: if this is a tournament match, fill in the next round
    if (updated.tournament_id && updated.match_number != null) {
      const nextMatchNum = Math.floor((updated.match_number - 1) / 2) + 1;
      const isPlayer1Slot = updated.match_number % 2 === 1; // odd = p1, even = p2

      // Find the next round match
      const roundOrder = ["round-of-16", "quarterfinal", "semifinal", "final"];
      const currentIdx = roundOrder.indexOf(updated.round);
      const nextRound = currentIdx >= 0 && currentIdx < roundOrder.length - 1 ? roundOrder[currentIdx + 1] : null;

      if (nextRound) {
        const slot = isPlayer1Slot ? "player1_id" : "player2_id";
        if (slot === "player1_id") {
          await sql`
            UPDATE activity_matches
            SET player1_id = ${body.winner_id}, status = CASE WHEN player2_id IS NOT NULL THEN 'open' ELSE status END
            WHERE tournament_id = ${updated.tournament_id} AND round = ${nextRound} AND match_number = ${nextMatchNum}
          `;
        } else {
          await sql`
            UPDATE activity_matches
            SET player2_id = ${body.winner_id}, status = CASE WHEN player1_id IS NOT NULL THEN 'open' ELSE status END
            WHERE tournament_id = ${updated.tournament_id} AND round = ${nextRound} AND match_number = ${nextMatchNum}
          `;
        }
      }
    }

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

/**
 * POST /event/:eventId/tournament — Create a KO tournament bracket.
 * Body: { type, player_ids: string[] }
 * Supports 2-16 players, auto-generates bracket with byes for odd counts.
 */
activities.post("/event/:eventId/tournament", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const body = await c.req.json<{ type: string; player_ids: string[] }>();

    if (!body.type || !body.player_ids || body.player_ids.length < 2) {
      return c.json({ error: "type und mindestens 2 Spieler erforderlich" }, 400);
    }

    // Find module
    const [mod] = await sql`
      SELECT id FROM event_modules WHERE event_id = ${eventId} AND type = ${body.type} AND active = true LIMIT 1
    `;

    // Shuffle players
    const players = [...body.player_ids].sort(() => Math.random() - 0.5);
    const count = players.length;

    // Calculate bracket size (next power of 2)
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(count)));

    // Determine rounds
    const roundNames: string[] = [];
    if (bracketSize >= 16) roundNames.push("round-of-16");
    if (bracketSize >= 8) roundNames.push("quarterfinal");
    if (bracketSize >= 4) roundNames.push("semifinal");
    roundNames.push("final");

    // Generate a tournament ID (reuse first match's group)
    const tournamentId = crypto.randomUUID();

    // Create first round matches (with byes)
    const firstRound = roundNames[0];
    const firstRoundMatches = bracketSize / 2;
    const byes = bracketSize - count;

    // Pair players: first `byes` slots get a bye (auto-advance)
    const pairs: { p1: string | null; p2: string | null }[] = [];
    let playerIdx = 0;
    for (let i = 0; i < firstRoundMatches; i++) {
      const p1 = playerIdx < players.length ? players[playerIdx++] : null;
      const p2 = playerIdx < players.length ? players[playerIdx++] : null;
      pairs.push({ p1, p2 });
    }

    const createdMatches = [];

    // Create first round matches
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const isBye = !pair.p1 || !pair.p2;
      const winner = isBye ? (pair.p1 || pair.p2) : null;

      const [m] = await sql`
        INSERT INTO activity_matches (event_id, module_id, type, player1_id, player2_id, winner_id, status, round, tournament_id, match_number)
        VALUES (${eventId}, ${mod?.id || null}, ${body.type},
                ${pair.p1}, ${pair.p2}, ${winner},
                ${isBye ? "completed" : "open"}, ${firstRound}, ${tournamentId}, ${i + 1})
        RETURNING *
      `;
      createdMatches.push(m);
    }

    // Create subsequent round matches (empty, pending)
    for (let r = 1; r < roundNames.length; r++) {
      const prevMatches = Math.pow(2, roundNames.length - r);
      const thisRoundMatches = prevMatches / 2;
      for (let i = 0; i < thisRoundMatches; i++) {
        const [m] = await sql`
          INSERT INTO activity_matches (event_id, module_id, type, status, round, tournament_id, match_number)
          VALUES (${eventId}, ${mod?.id || null}, ${body.type}, 'pending', ${roundNames[r]}, ${tournamentId}, ${i + 1})
          RETURNING *
        `;
        createdMatches.push(m);
      }
    }

    // Auto-advance byes to next round
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair.p1 || !pair.p2) {
        const winner = pair.p1 || pair.p2;
        if (!winner) continue;
        const nextMatchNum = Math.floor(i / 2) + 1;
        const isP1Slot = i % 2 === 0;
        const nextRound = roundNames[1];
        if (nextRound) {
          if (isP1Slot) {
            await sql`UPDATE activity_matches SET player1_id = ${winner}, status = CASE WHEN player2_id IS NOT NULL THEN 'open' ELSE status END WHERE tournament_id = ${tournamentId} AND round = ${nextRound} AND match_number = ${nextMatchNum}`;
          } else {
            await sql`UPDATE activity_matches SET player2_id = ${winner}, status = CASE WHEN player1_id IS NOT NULL THEN 'open' ELSE status END WHERE tournament_id = ${tournamentId} AND round = ${nextRound} AND match_number = ${nextMatchNum}`;
          }
        }
      }
    }

    return c.json({ tournament_id: tournamentId, matches: createdMatches.length, rounds: roundNames }, 201);
  } catch (err) {
    console.error("POST /activities/event/:eventId/tournament error:", err);
    return c.json({ error: "Turnier-Erstellung fehlgeschlagen" }, 500);
  }
});

/**
 * GET /event/:eventId/tournament — Get tournament bracket.
 * Query: ?type=billiards
 */
activities.get("/event/:eventId/tournament", async (c) => {
  try {
    const eventId = c.req.param("eventId");
    const type = c.req.query("type");

    const matches = await sql`
      SELECT am.*,
             p1.display_name AS player1_name, p1.avatar_emoji AS player1_emoji,
             p2.display_name AS player2_name, p2.avatar_emoji AS player2_emoji,
             w.display_name AS winner_name
      FROM activity_matches am
      LEFT JOIN group_members p1 ON p1.id = am.player1_id
      LEFT JOIN group_members p2 ON p2.id = am.player2_id
      LEFT JOIN group_members w ON w.id = am.winner_id
      WHERE am.event_id = ${eventId} AND am.tournament_id IS NOT NULL
        ${type ? sql`AND am.type = ${type}` : sql``}
      ORDER BY am.tournament_id DESC,
        CASE am.round
          WHEN 'round-of-16' THEN 1
          WHEN 'quarterfinal' THEN 2
          WHEN 'semifinal' THEN 3
          WHEN 'final' THEN 4
        END,
        am.match_number ASC
    `;

    // Group by tournament
    const tournaments: Record<string, { id: string; rounds: Record<string, any[]> }> = {};
    for (const m of matches) {
      if (!tournaments[m.tournament_id]) {
        tournaments[m.tournament_id] = { id: m.tournament_id, rounds: {} };
      }
      if (!tournaments[m.tournament_id].rounds[m.round]) {
        tournaments[m.tournament_id].rounds[m.round] = [];
      }
      tournaments[m.tournament_id].rounds[m.round].push(m);
    }

    return c.json({ tournaments: Object.values(tournaments) });
  } catch (err) {
    console.error("GET /activities/event/:eventId/tournament error:", err);
    return c.json({ error: "Failed to fetch tournament" }, 500);
  }
});

export default activities;
