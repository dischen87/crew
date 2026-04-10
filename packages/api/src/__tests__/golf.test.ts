import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { api, createTestGroup, cleanTestData } from "./setup";

let ctx: Awaited<ReturnType<typeof createTestGroup>>;
let courseId: string;
let roundId: string;

beforeAll(async () => {
  await cleanTestData();
  ctx = await createTestGroup("Golf Test Crew");

  // Create an event for this group (admin route creates one automatically on register,
  // but we may need to create one explicitly if register doesn't)
  if (!ctx.event?.id) {
    const { data } = await api("/admin/event", {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({
        title: "Test Golf Event",
        date_from: "2026-04-01",
        date_to: "2026-04-10",
      }),
    });
    ctx.event = data.event;
  }
});

afterAll(async () => {
  await cleanTestData();
});

describe("Admin: Golf Course Import", () => {
  test("POST /admin/golf/course — creates course with 18 holes", async () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1,
      par: i % 3 === 0 ? 5 : i % 3 === 1 ? 3 : 4,
      distance_m: 300 + i * 10,
      handicap_index: i + 1,
    }));
    const par_total = holes.reduce((s, h) => s + h.par, 0);

    const { status, data } = await api("/admin/golf/course", {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({
        name: "Test Course",
        location: "Teststadt",
        country: "CH",
        par_total,
        course_rating: 72.5,
        slope_rating: 130,
        holes,
      }),
    });

    expect(status).toBe(201);
    expect(data.course?.id).toBeTruthy();
    expect(data.course?.name).toBe("Test Course");
    courseId = data.course.id;
  });

  test("GET /golf/course/:id — returns imported course with holes", async () => {
    const { status, data } = await api(`/golf/course/${courseId}`, { token: ctx.token });
    expect(status).toBe(200);
    expect(data.course?.name).toBe("Test Course");
    expect(data.holes?.length).toBe(18);
  });

  test("POST /admin/golf/course — rejects course with wrong par_total", async () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1, par: 4, distance_m: 300, handicap_index: i + 1,
    }));

    const { status } = await api("/admin/golf/course", {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({ name: "Bad Course", par_total: 99, holes }),
    });

    expect(status).toBe(400);
  });

  test("POST /admin/golf/course — rejects with 17 holes", async () => {
    const holes = Array.from({ length: 17 }, (_, i) => ({
      hole_number: i + 1, par: 4, distance_m: 300, handicap_index: i + 1,
    }));

    const { status } = await api("/admin/golf/course", {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({ name: "Short Course", par_total: 68, holes }),
    });

    expect(status).toBe(400);
  });
});

describe("Golf Rounds", () => {
  test("POST /golf/event/:id/round — creates round", async () => {
    const { status, data } = await api(`/golf/event/${ctx.event.id}/round`, {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({
        course_id: courseId,
        date: "2026-04-05",
        tee_time: "08:00",
        notes: "Test round",
      }),
    });

    expect(status).toBe(201);
    expect(data.round?.id).toBeTruthy();
    roundId = data.round.id;
  });
});

describe("Score Audit Trail", () => {
  test("POST /golf/event/:id/score — submits a score", async () => {
    // First set a handicap
    await api(`/golf/handicap/${ctx.event.id}`, {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({ handicap: 18 }),
    });

    const { status, data } = await api(`/golf/event/${ctx.event.id}/score`, {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({ round_id: roundId, hole: 1, strokes: 5 }),
    });

    expect(status).toBe(200);
    expect(data.score?.strokes).toBe(5);
  });

  test("POST /golf/event/:id/score — editing score logs old value to history", async () => {
    // Submit new score for same hole (edit)
    const { status, data } = await api(`/golf/event/${ctx.event.id}/score`, {
      method: "POST",
      token: ctx.token,
      body: JSON.stringify({ round_id: roundId, hole: 1, strokes: 4 }),
    });

    expect(status).toBe(200);
    expect(data.score?.strokes).toBe(4); // new value

    // Check history — old value should be there
    const history = await sql`
      SELECT * FROM golf_score_history
      WHERE round_id = ${roundId} AND member_id = ${ctx.member.id} AND hole = 1
      ORDER BY created_at DESC
    `;

    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].strokes).toBe(5); // original score preserved
    expect(history[0].action).toBe("update");
  });

  test("DELETE /golf/event/:id/score — logs deleted score to history", async () => {
    const { status } = await api(`/golf/event/${ctx.event.id}/score`, {
      method: "DELETE",
      token: ctx.token,
      body: JSON.stringify({ round_id: roundId, hole: 1 }),
    });

    expect(status).toBe(200);

    // Check history — deleted score should be logged
    const history = await sql`
      SELECT * FROM golf_score_history
      WHERE round_id = ${roundId} AND member_id = ${ctx.member.id} AND hole = 1 AND action = 'delete'
    `;

    expect(history.length).toBe(1);
    expect(history[0].strokes).toBe(4); // the edited value that was deleted
  });

  test("GET /golf/event/:id/score-history — admin can view history", async () => {
    const { status, data } = await api(`/golf/event/${ctx.event.id}/score-history`, {
      token: ctx.token,
    });

    expect(status).toBe(200);
    expect(data.history?.length).toBeGreaterThanOrEqual(2); // update + delete
  });
});
