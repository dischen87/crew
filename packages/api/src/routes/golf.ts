import { Hono } from "hono";
import { sql } from "../db/client";
import { authMiddleware, getMember } from "../middleware/auth";

const golf = new Hono();
golf.use("*", authMiddleware);

/**
 * Calculate stableford points for a hole.
 * @param strokes - gross strokes taken
 * @param par - hole par
 * @param strokesReceived - extra strokes the player receives on this hole (based on handicap)
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
  // Full strokes: every hole gets floor(handicap/18)
  // Remaining strokes go to holes with handicap_index <= remainder
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

    const rounds = await sql`
      SELECT r.id, r.course_id, r.format, r.date, r.tee_time,
             c.name AS course_name, c.par_total
      FROM golf_rounds r
      LEFT JOIN golf_courses c ON c.id = r.course_id
      WHERE r.event_id = ${eventId}
      ORDER BY r.date ASC
    `;

    // Leaderboard: sum stableford points per member across all rounds for this event
    const leaderboard = await sql`
      SELECT
        gm.id AS member_id,
        gm.display_name,
        COALESCE(SUM(gs.stableford), 0)::int AS total_points,
        COUNT(DISTINCT gs.round_id)::int AS rounds_played,
        COALESCE(SUM(gs.strokes), 0)::int AS total_strokes
      FROM group_members gm
      LEFT JOIN golf_scores gs ON gs.member_id = gm.id
      LEFT JOIN golf_rounds gr ON gr.id = gs.round_id AND gr.event_id = ${eventId}
      WHERE gm.group_id = (SELECT group_id FROM events WHERE id = ${eventId})
      GROUP BY gm.id, gm.display_name
      ORDER BY total_points DESC
    `;

    return c.json({ rounds, leaderboard });
  } catch (err) {
    console.error("GET /golf/event/:id error:", err);
    return c.json({ error: "Failed to fetch golf data" }, 500);
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

    return c.json({ score });
  } catch (err) {
    console.error("POST /golf/event/:id/score error:", err);
    return c.json({ error: "Failed to submit score" }, 500);
  }
});

export default golf;
