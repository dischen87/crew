/**
 * Seed script for Belek Golf Trip 2026
 * Run with: bun src/db/seed-belek.ts
 */
import { sql } from "./client";

async function seed() {
  console.log("[Seed] Starting Belek 2026 seed...");

  // Clean existing data
  await sql`DELETE FROM golf_scores`;
  await sql`DELETE FROM golf_player_handicaps`;
  await sql`DELETE FROM golf_rounds`;
  await sql`DELETE FROM golf_course_holes`;
  await sql`DELETE FROM golf_courses`;
  await sql`DELETE FROM participant_flights`;
  await sql`DELETE FROM participant_extras`;
  await sql`DELETE FROM participant_packages`;
  await sql`DELETE FROM participant_forms`;
  await sql`DELETE FROM flights`;
  await sql`DELETE FROM trip_extras`;
  await sql`DELETE FROM trip_packages`;
  await sql`DELETE FROM event_modules`;
  await sql`DELETE FROM messages`;
  await sql`DELETE FROM media`;
  await sql`DELETE FROM bets`;
  await sql`DELETE FROM events`;
  await sql`DELETE FROM group_members`;
  await sql`DELETE FROM groups`;

  // Add notes column to golf_rounds if not exists
  await sql`ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS notes TEXT`;

  // ============================================
  // 1. GROUP
  // ============================================
  const [group] = await sql`
    INSERT INTO groups (name, invite_code)
    VALUES ('Belek Golf Crew 2026', 'BELEK26')
    RETURNING id
  `;
  console.log("[Seed] Group created:", group.id);

  // ============================================
  // 2. MEMBERS (15 participants)
  // ============================================
  const memberData = [
    { name: "Benjamin Konzett", emoji: "🏌️", admin: true },
    { name: "Christian Probst", emoji: "⛳" },
    { name: "Markus Weinand", emoji: "🏆" },
    { name: "Fabio Kellerhals", emoji: "🎯" },
    { name: "Patrick Probst", emoji: "💪" },
    { name: "Dominic Müller", emoji: "🔥" },
    { name: "Jürg Probst", emoji: "🎳" },
    { name: "Kevin Amacker", emoji: "⚡" },
    { name: "Constantine Lagoudakis", emoji: "🇬🇷" },
    { name: "Dominik Bohren", emoji: "🎿" },
    { name: "Dygis Winkler", emoji: "🏎️" },
    { name: "Mathias Inäbnit", emoji: "🎲" },
    { name: "Martin Steffen", emoji: "🃏" },
    { name: "Christof Schaub", emoji: "🍺" },
    { name: "Mathias Graf", emoji: "🦅" },
  ];

  // Default password for all seeded members (they can change it later)
  const defaultPassword = process.env.EVENT_PASSWORD || "BelekGolf4ever";
  const passwordHash = await Bun.password.hash(defaultPassword, { algorithm: "bcrypt", cost: 10 });

  const members: Record<string, string> = {};
  for (const m of memberData) {
    const [row] = await sql`
      INSERT INTO group_members (group_id, display_name, password_hash, avatar_emoji, is_admin)
      VALUES (${group.id}, ${m.name}, ${passwordHash}, ${m.emoji}, ${m.admin ?? false})
      RETURNING id
    `;
    members[m.name] = row.id;
  }
  console.log("[Seed] 15 members created");

  // ============================================
  // 3. EVENT
  // ============================================
  const [event] = await sql`
    INSERT INTO events (group_id, title, type, date_from, date_to, location, status)
    VALUES (
      ${group.id},
      'Golfreise Belek 2026',
      'golf',
      '2026-04-08',
      '2026-04-15',
      'Cornelia Diamond Golf Resort & Spa, Belek, Türkei',
      'active'
    )
    RETURNING id
  `;
  console.log("[Seed] Event created:", event.id);

  // ============================================
  // 4. EVENT MODULES
  // ============================================
  const moduleTypes = [
    { type: "golf", config: { format: "stableford" }, order: 1 },
    { type: "leaderboard", config: {}, order: 2 },
    { type: "flights", config: {}, order: 3 },
    { type: "chat", config: {}, order: 4 },
    { type: "media", config: {}, order: 5 },
    { type: "masters_pool", config: {
      url: "http://www.easyofficepools.com/join/?p=464087&e=wlld",
      leaderboard_url: "http://www.easyofficepools.com/leaderboard/?p=464087",
      buy_in: "20 CHF",
      prizes: { first: "50%", second: "30%", third: "20%" }
    }, order: 6 },
  ];

  for (const mod of moduleTypes) {
    await sql`
      INSERT INTO event_modules (event_id, type, config, sort_order)
      VALUES (${event.id}, ${mod.type}, ${sql.json(mod.config)}, ${mod.order})
    `;
  }
  console.log("[Seed] Event modules created");

  // ============================================
  // 5. PARTICIPANT FORMS (needed for flight assignments)
  // ============================================
  const forms: Record<string, string> = {};
  for (const [name, memberId] of Object.entries(members)) {
    const [form] = await sql`
      INSERT INTO participant_forms (event_id, member_id, status)
      VALUES (${event.id}, ${memberId}, 'pending')
      RETURNING id
    `;
    forms[name] = form.id;
  }
  console.log("[Seed] Participant forms created");

  // ============================================
  // 6. FLIGHTS
  // ============================================

  // Outbound flights
  const outboundFlights = [
    {
      airline: "SunExpress", flight_number: "XQ0125", direction: "outbound",
      departure_airport: "ZRH (Zürich)", arrival_airport: "AYT (Antalya)",
      departure_time: "2026-04-08T09:40:00+02:00", arrival_time: "2026-04-08T13:55:00+03:00",
      passengers: ["Markus Weinand", "Fabio Kellerhals"],
    },
    {
      airline: "Edelweiss", flight_number: "WK186", direction: "outbound",
      departure_airport: "ZRH (Zürich)", arrival_airport: "AYT (Antalya)",
      departure_time: "2026-04-08T15:05:00+02:00", arrival_time: "2026-04-08T19:30:00+03:00",
      passengers: ["Christian Probst", "Patrick Probst", "Dominic Müller", "Jürg Probst"],
    },
    {
      airline: "Edelweiss", flight_number: "WK186", direction: "outbound",
      departure_airport: "ZRH (Zürich)", arrival_airport: "AYT (Antalya)",
      departure_time: "2026-04-08T15:10:00+02:00", arrival_time: "2026-04-08T19:25:00+03:00",
      passengers: ["Kevin Amacker"],
    },
    {
      airline: "SunExpress", flight_number: "XQ125", direction: "outbound",
      departure_airport: "ZRH (Zürich)", arrival_airport: "AYT (Antalya)",
      departure_time: "2026-04-08T09:40:00+02:00", arrival_time: "2026-04-08T13:55:00+03:00",
      passengers: ["Mathias Graf"],
    },
    {
      airline: "SunExpress", flight_number: "XQ125", direction: "outbound",
      departure_airport: "ZRH (Zürich)", arrival_airport: "AYT (Antalya)",
      departure_time: "2026-04-09T09:40:00+02:00", arrival_time: "2026-04-09T13:55:00+03:00",
      passengers: ["Constantine Lagoudakis", "Dominik Bohren", "Dygis Winkler", "Mathias Inäbnit", "Martin Steffen", "Christof Schaub"],
    },
    // Benjamin Konzett — no outbound flight listed (kommt separat)
  ];

  // Return flights
  const returnFlights = [
    {
      airline: "Edelweiss", flight_number: "WK187", direction: "return",
      departure_airport: "AYT (Antalya)", arrival_airport: "ZRH (Zürich)",
      departure_time: "2026-04-15T20:15:00+03:00", arrival_time: "2026-04-15T22:55:00+02:00",
      passengers: ["Christian Probst", "Patrick Probst", "Dominic Müller", "Jürg Probst", "Kevin Amacker"],
    },
    {
      airline: "SunExpress", flight_number: "XQ0120", direction: "return",
      departure_airport: "AYT (Antalya)", arrival_airport: "ZRH (Zürich)",
      departure_time: "2026-04-15T14:55:00+03:00", arrival_time: "2026-04-15T17:35:00+02:00",
      passengers: ["Markus Weinand", "Fabio Kellerhals"],
    },
    {
      airline: "SunExpress", flight_number: "XQ590", direction: "return",
      departure_airport: "AYT (Antalya)", arrival_airport: "ZRH (Zürich)",
      departure_time: "2026-04-15T07:55:00+03:00", arrival_time: "2026-04-15T10:35:00+02:00",
      passengers: ["Mathias Graf"],
    },
    {
      airline: "SunExpress", flight_number: "XQ120", direction: "return",
      departure_airport: "AYT (Antalya)", arrival_airport: "ZRH (Zürich)",
      departure_time: "2026-04-14T14:55:00+03:00", arrival_time: "2026-04-14T17:35:00+02:00",
      passengers: ["Benjamin Konzett", "Constantine Lagoudakis", "Dominik Bohren", "Dygis Winkler", "Mathias Inäbnit", "Martin Steffen", "Christof Schaub"],
    },
  ];

  for (const flight of [...outboundFlights, ...returnFlights]) {
    const [f] = await sql`
      INSERT INTO flights (event_id, direction, airline, flight_number,
                          departure_airport, arrival_airport, departure_time, arrival_time)
      VALUES (${event.id}, ${flight.direction}, ${flight.airline}, ${flight.flight_number},
              ${flight.departure_airport}, ${flight.arrival_airport},
              ${flight.departure_time}, ${flight.arrival_time})
      RETURNING id
    `;

    for (const pName of flight.passengers) {
      const formId = forms[pName];
      if (formId) {
        await sql`
          INSERT INTO participant_flights (participant_id, flight_id)
          VALUES (${formId}, ${f.id})
        `;
      }
    }
  }
  console.log("[Seed] Flights created");

  // ============================================
  // 7. GOLF COURSES (5 courses)
  // ============================================

  // Real golf course data from verified scorecards (owltourism.com, official websites)
  const courseData = [
    {
      name: "Montgomerie Golf Course",
      location: "Maxx Royal, Belek",
      country: "TR",
      par_total: 72,
      course_rating: 74.3,
      slope_rating: 143,
      holes: [
        { hole_number: 1,  par: 5, distance_m: 522, handicap_index: 7 },
        { hole_number: 2,  par: 3, distance_m: 148, handicap_index: 17 },
        { hole_number: 3,  par: 4, distance_m: 367, handicap_index: 13 },
        { hole_number: 4,  par: 5, distance_m: 527, handicap_index: 9 },
        { hole_number: 5,  par: 3, distance_m: 205, handicap_index: 11 },
        { hole_number: 6,  par: 4, distance_m: 441, handicap_index: 1 },
        { hole_number: 7,  par: 4, distance_m: 420, handicap_index: 5 },
        { hole_number: 8,  par: 3, distance_m: 166, handicap_index: 15 },
        { hole_number: 9,  par: 4, distance_m: 408, handicap_index: 3 },
        { hole_number: 10, par: 4, distance_m: 331, handicap_index: 16 },
        { hole_number: 11, par: 5, distance_m: 521, handicap_index: 10 },
        { hole_number: 12, par: 4, distance_m: 448, handicap_index: 2 },
        { hole_number: 13, par: 5, distance_m: 516, handicap_index: 8 },
        { hole_number: 14, par: 3, distance_m: 161, handicap_index: 14 },
        { hole_number: 15, par: 4, distance_m: 308, handicap_index: 6 },
        { hole_number: 16, par: 3, distance_m: 165, handicap_index: 18 },
        { hole_number: 17, par: 4, distance_m: 358, handicap_index: 12 },
        { hole_number: 18, par: 5, distance_m: 510, handicap_index: 4 },
      ],
    },
    {
      name: "Cullinan Links Golf Course",
      location: "Gloria Golf Resort, Belek",
      country: "TR",
      par_total: 72,
      course_rating: 70.5,
      slope_rating: 130,
      holes: [
        { hole_number: 1,  par: 4, distance_m: 396, handicap_index: 4 },
        { hole_number: 2,  par: 4, distance_m: 290, handicap_index: 16 },
        { hole_number: 3,  par: 3, distance_m: 124, handicap_index: 18 },
        { hole_number: 4,  par: 4, distance_m: 298, handicap_index: 12 },
        { hole_number: 5,  par: 5, distance_m: 429, handicap_index: 8 },
        { hole_number: 6,  par: 4, distance_m: 341, handicap_index: 2 },
        { hole_number: 7,  par: 3, distance_m: 110, handicap_index: 14 },
        { hole_number: 8,  par: 4, distance_m: 365, handicap_index: 6 },
        { hole_number: 9,  par: 5, distance_m: 447, handicap_index: 10 },
        { hole_number: 10, par: 4, distance_m: 358, handicap_index: 11 },
        { hole_number: 11, par: 5, distance_m: 478, handicap_index: 9 },
        { hole_number: 12, par: 4, distance_m: 360, handicap_index: 5 },
        { hole_number: 13, par: 3, distance_m: 152, handicap_index: 13 },
        { hole_number: 14, par: 4, distance_m: 312, handicap_index: 7 },
        { hole_number: 15, par: 4, distance_m: 346, handicap_index: 1 },
        { hole_number: 16, par: 4, distance_m: 415, handicap_index: 3 },
        { hole_number: 17, par: 3, distance_m: 139, handicap_index: 15 },
        { hole_number: 18, par: 5, distance_m: 447, handicap_index: 17 },
      ],
    },
    {
      name: "Cornelia Faldo Golf Course",
      location: "Cornelia Diamond, Belek",
      country: "TR",
      par_total: 72,
      course_rating: 74.8,
      slope_rating: 147,
      holes: [
        { hole_number: 1,  par: 4, distance_m: 385, handicap_index: 5 },
        { hole_number: 2,  par: 5, distance_m: 510, handicap_index: 3 },
        { hole_number: 3,  par: 3, distance_m: 175, handicap_index: 15 },
        { hole_number: 4,  par: 4, distance_m: 410, handicap_index: 1 },
        { hole_number: 5,  par: 4, distance_m: 370, handicap_index: 9 },
        { hole_number: 6,  par: 3, distance_m: 195, handicap_index: 13 },
        { hole_number: 7,  par: 5, distance_m: 535, handicap_index: 7 },
        { hole_number: 8,  par: 4, distance_m: 355, handicap_index: 11 },
        { hole_number: 9,  par: 4, distance_m: 425, handicap_index: 17 },
        { hole_number: 10, par: 4, distance_m: 400, handicap_index: 4 },
        { hole_number: 11, par: 3, distance_m: 160, handicap_index: 16 },
        { hole_number: 12, par: 4, distance_m: 395, handicap_index: 8 },
        { hole_number: 13, par: 5, distance_m: 520, handicap_index: 2 },
        { hole_number: 14, par: 4, distance_m: 380, handicap_index: 10 },
        { hole_number: 15, par: 3, distance_m: 185, handicap_index: 18 },
        { hole_number: 16, par: 5, distance_m: 505, handicap_index: 6 },
        { hole_number: 17, par: 4, distance_m: 365, handicap_index: 14 },
        { hole_number: 18, par: 4, distance_m: 430, handicap_index: 12 },
      ],
    },
    {
      name: "Kaya Palazzo Golf Course",
      location: "Kaya Palazzo, Belek",
      country: "TR",
      par_total: 72,
      course_rating: 71.0,
      slope_rating: 127,
      holes: [
        { hole_number: 1,  par: 5, distance_m: 463, handicap_index: 5 },
        { hole_number: 2,  par: 4, distance_m: 304, handicap_index: 9 },
        { hole_number: 3,  par: 4, distance_m: 389, handicap_index: 1 },
        { hole_number: 4,  par: 3, distance_m: 147, handicap_index: 17 },
        { hole_number: 5,  par: 5, distance_m: 479, handicap_index: 3 },
        { hole_number: 6,  par: 3, distance_m: 163, handicap_index: 13 },
        { hole_number: 7,  par: 4, distance_m: 336, handicap_index: 11 },
        { hole_number: 8,  par: 4, distance_m: 323, handicap_index: 15 },
        { hole_number: 9,  par: 5, distance_m: 437, handicap_index: 7 },
        { hole_number: 10, par: 4, distance_m: 304, handicap_index: 16 },
        { hole_number: 11, par: 3, distance_m: 181, handicap_index: 8 },
        { hole_number: 12, par: 4, distance_m: 377, handicap_index: 12 },
        { hole_number: 13, par: 5, distance_m: 472, handicap_index: 4 },
        { hole_number: 14, par: 3, distance_m: 190, handicap_index: 14 },
        { hole_number: 15, par: 4, distance_m: 356, handicap_index: 10 },
        { hole_number: 16, par: 3, distance_m: 155, handicap_index: 18 },
        { hole_number: 17, par: 4, distance_m: 361, handicap_index: 2 },
        { hole_number: 18, par: 5, distance_m: 505, handicap_index: 6 },
      ],
    },
    {
      name: "Carya Golf Course",
      location: "Regnum Carya, Belek",
      country: "TR",
      par_total: 72,
      course_rating: 74.9,
      slope_rating: 145,
      holes: [
        { hole_number: 1,  par: 4, distance_m: 391, handicap_index: 16 },
        { hole_number: 2,  par: 3, distance_m: 209, handicap_index: 12 },
        { hole_number: 3,  par: 4, distance_m: 416, handicap_index: 8 },
        { hole_number: 4,  par: 4, distance_m: 368, handicap_index: 4 },
        { hole_number: 5,  par: 4, distance_m: 364, handicap_index: 6 },
        { hole_number: 6,  par: 3, distance_m: 177, handicap_index: 10 },
        { hole_number: 7,  par: 5, distance_m: 553, handicap_index: 2 },
        { hole_number: 8,  par: 3, distance_m: 172, handicap_index: 14 },
        { hole_number: 9,  par: 4, distance_m: 383, handicap_index: 18 },
        { hole_number: 10, par: 5, distance_m: 496, handicap_index: 5 },
        { hole_number: 11, par: 4, distance_m: 343, handicap_index: 1 },
        { hole_number: 12, par: 5, distance_m: 498, handicap_index: 13 },
        { hole_number: 13, par: 4, distance_m: 373, handicap_index: 9 },
        { hole_number: 14, par: 3, distance_m: 157, handicap_index: 17 },
        { hole_number: 15, par: 5, distance_m: 494, handicap_index: 11 },
        { hole_number: 16, par: 4, distance_m: 395, handicap_index: 15 },
        { hole_number: 17, par: 4, distance_m: 406, handicap_index: 3 },
        { hole_number: 18, par: 4, distance_m: 410, handicap_index: 7 },
      ],
    },
  ];

  const courses: Record<string, string> = {};
  for (const course of courseData) {
    const [c] = await sql`
      INSERT INTO golf_courses (name, location, country, total_holes, par_total, course_rating, slope_rating, source)
      VALUES (${course.name}, ${course.location}, ${course.country}, 18, ${course.par_total},
              ${course.course_rating}, ${course.slope_rating}, 'manual')
      RETURNING id
    `;
    courses[course.name] = c.id;

    for (const hole of course.holes) {
      await sql`
        INSERT INTO golf_course_holes (course_id, hole_number, par, distance_m, handicap_index)
        VALUES (${c.id}, ${hole.hole_number}, ${hole.par}, ${hole.distance_m}, ${hole.handicap_index})
      `;
    }
  }
  console.log("[Seed] 5 golf courses created with hole data");

  // ============================================
  // 8. GOLF ROUNDS (7 rounds)
  // ============================================
  const roundData = [
    {
      course: "Montgomerie Golf Course",
      date: "2026-04-09",
      tee_time: "13:30",
      format: "stableford",
      notes: "Shuttle Pickup: 12:30 Uhr am Hotel. 18 Loch, 7+1 Pax. Erster Tag auf dem Platz!",
    },
    {
      course: "Cullinan Links Golf Course",
      date: "2026-04-10",
      tee_time: "07:54",
      format: "stableford",
      notes: "Früh-Runde! Shuttle vorhanden. Buggy inklusive (shared/geteilt). Links-Platz am Meer.",
    },
    {
      course: "Montgomerie Golf Course",
      date: "2026-04-10",
      tee_time: "15:00",
      format: "stableford",
      notes: "Nachmittagsrunde am Montgomerie (Cornelia Diamond). Greenfee-Only. 13 Pax gesamt.",
    },
    {
      course: "Cornelia Faldo Golf Course",
      date: "2026-04-11",
      tee_time: "08:20",
      format: "stableford",
      notes: "Queen Course. Direkt am Hotel — kein Shuttle nötig. Nick Faldo Design.",
    },
    {
      course: "Carya Golf Course",
      date: "2026-04-11",
      tee_time: "18:18",
      format: "stableford",
      notes: "Twilight-Runde auf dem Carya (Cornelia Diamond). Greenfee-Only. 12 Pax.",
    },
    {
      course: "Kaya Palazzo Golf Course",
      date: "2026-04-12",
      tee_time: "13:24",
      format: "stableford",
      notes: "Shuttle vorhanden. Kaya Palazzo — einer der Top-Plätze in Belek.",
    },
    {
      course: "Cornelia Faldo Golf Course",
      date: "2026-04-13",
      tee_time: "12:30",
      format: "stableford",
      notes: "King Course. Direkt am Hotel. Letzte Runde der Woche — Finale!",
    },
  ];

  const roundIds: string[] = [];
  for (const round of roundData) {
    const [r] = await sql`
      INSERT INTO golf_rounds (event_id, course_id, format, date, tee_time, notes)
      VALUES (${event.id}, ${courses[round.course]}, ${round.format}, ${round.date}, ${round.tee_time}, ${round.notes})
      RETURNING id
    `;
    roundIds.push(r.id);
  }
  console.log("[Seed] 7 golf rounds created");

  // ============================================
  // 9. WELCOME MESSAGE IN CHAT
  // ============================================
  await sql`
    INSERT INTO messages (group_id, sender_id, content, type)
    VALUES (
      ${group.id},
      ${members["Benjamin Konzett"]},
      'Willkommen zur Golfreise Belek 2026! 🏌️⛳ 7 Nächte, 7 Runden, 15 Spieler. Let''s go!',
      'text'
    )
  `;
  await sql`
    INSERT INTO messages (group_id, sender_id, content, type)
    VALUES (
      ${group.id},
      ${members["Benjamin Konzett"]},
      'Masters Pool ist live! 🏆 Einsatz 20 CHF. Link findet ihr unter "Masters Pool" in der App. Picks: http://www.easyofficepools.com/join/?p=464087&e=wlld',
      'text'
    )
  `;
  console.log("[Seed] Welcome messages created");

  // ============================================
  // SUMMARY
  // ============================================
  console.log("\n[Seed] ===== Belek 2026 Seed Complete =====");
  console.log(`  Group:    ${group.id} (BELEK26)`);
  console.log(`  Event:    ${event.id}`);
  console.log(`  Members:  15`);
  console.log(`  Courses:  5`);
  console.log(`  Rounds:   7`);
  console.log(`  Flights:  ${outboundFlights.length + returnFlights.length}`);
  console.log(`  Password: BelekGolf4ever`);
  console.log("==========================================\n");

  process.exit(0);
}

seed().catch((err) => {
  console.error("[Seed] Error:", err);
  process.exit(1);
});
