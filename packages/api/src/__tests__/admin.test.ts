import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { api, createTestGroup, cleanTestData } from "./setup";

let adminCtx: Awaited<ReturnType<typeof createTestGroup>>;
let normalToken: string;

beforeAll(async () => {
  await cleanTestData();
  adminCtx = await createTestGroup("Admin Test Crew");

  // Join as non-admin member
  const { data } = await api("/auth/join", {
    method: "POST",
    body: JSON.stringify({
      invite_code: adminCtx.group.invite_code,
      name: "Normal User",
      password: "test1234",
      emoji: "👤",
    }),
  });
  normalToken = data.token;
});

afterAll(async () => {
  await cleanTestData();
});

describe("Admin Authorization", () => {
  test("Non-admin cannot import courses", async () => {
    const { status } = await api("/admin/golf/course", {
      method: "POST",
      token: normalToken,
      body: JSON.stringify({ name: "Test", par_total: 72, holes: [] }),
    });
    expect(status).toBe(403);
  });

  test("Non-admin cannot import flights", async () => {
    const { status } = await api("/admin/flights", {
      method: "POST",
      token: normalToken,
      body: JSON.stringify({
        event_id: adminCtx.event.id,
        direction: "outbound",
        airline: "Test",
        flight_number: "T123",
        departure_airport: "ZRH",
        arrival_airport: "AYT",
        departure_time: "2026-04-08T09:00:00Z",
        arrival_time: "2026-04-08T13:00:00Z",
      }),
    });
    expect(status).toBe(403);
  });

  test("Non-admin cannot use bulk import", async () => {
    const { status } = await api("/admin/import", {
      method: "POST",
      token: normalToken,
      body: JSON.stringify({ event_id: adminCtx.event.id }),
    });
    expect(status).toBe(403);
  });
});

describe("Bulk Import", () => {
  test("POST /admin/import — imports courses, rounds, flights in one call", async () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1, par: 4, distance_m: 350, handicap_index: i + 1,
    }));

    const { status, data } = await api("/admin/import", {
      method: "POST",
      token: adminCtx.token,
      body: JSON.stringify({
        event_id: adminCtx.event.id,
        courses: [{
          name: "Bulk Import Course",
          location: "Test",
          par_total: 72,
          holes,
        }],
        rounds: [{
          course_name: "Bulk Import Course",
          date: "2026-04-05",
          tee_time: "10:00",
          notes: "Bulk imported round",
        }],
        flights: [{
          direction: "outbound",
          airline: "Swiss",
          flight_number: "LX1234",
          departure_airport: "ZRH",
          arrival_airport: "AYT",
          departure_time: "2026-04-08T09:00:00+02:00",
          arrival_time: "2026-04-08T13:00:00+03:00",
          passenger_names: ["Test Admin"],
        }],
      }),
    });

    expect(status).toBe(201);
    expect(data.imported.courses).toBe(1);
    expect(data.imported.rounds).toBe(1);
    expect(data.imported.flights).toBe(1);
  });

  test("POST /admin/import — rejects with unknown course name in round", async () => {
    const { status, data } = await api("/admin/import", {
      method: "POST",
      token: adminCtx.token,
      body: JSON.stringify({
        event_id: adminCtx.event.id,
        rounds: [{
          course_name: "Non Existent Course",
          date: "2026-04-06",
        }],
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toContain("nicht gefunden");
  });
});

describe("Flight Import", () => {
  test("POST /admin/flights — creates flight with passenger linking", async () => {
    const { status, data } = await api("/admin/flights", {
      method: "POST",
      token: adminCtx.token,
      body: JSON.stringify({
        event_id: adminCtx.event.id,
        direction: "return",
        airline: "Edelweiss",
        flight_number: "WK999",
        departure_airport: "AYT",
        arrival_airport: "ZRH",
        departure_time: "2026-04-15T20:00:00+03:00",
        arrival_time: "2026-04-15T22:30:00+02:00",
        passenger_names: ["Test Admin", "Normal User"],
      }),
    });

    expect(status).toBe(201);
    expect(data.flight?.id).toBeTruthy();
    expect(data.passengers_linked).toBe(2);
  });

  test("GET /flights/event/:id — returns flights with passengers", async () => {
    const { status, data } = await api(`/flights/event/${adminCtx.event.id}`, {
      token: adminCtx.token,
    });

    expect(status).toBe(200);
    expect(data.flights?.length).toBeGreaterThanOrEqual(1);
  });
});
