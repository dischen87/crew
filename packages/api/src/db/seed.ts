import { sql } from "./client";

async function seed() {
  console.log("Seeding database...");

  // 1. Group
  const [group] = await sql`
    INSERT INTO groups (id, name, invite_code)
    VALUES (
      'a1b2c3d4-0000-0000-0000-000000000001',
      'Belek 2025 Crew',
      'BELEK25'
    )
    ON CONFLICT (invite_code) DO NOTHING
    RETURNING id
  `;
  const groupId = group?.id ?? "a1b2c3d4-0000-0000-0000-000000000001";

  // 2. Members
  const members = [
    { id: "m0000000-0000-0000-0000-000000000001", name: "Mathias", admin: true },
    { id: "m0000000-0000-0000-0000-000000000002", name: "Reto", admin: false },
    { id: "m0000000-0000-0000-0000-000000000003", name: "Adrian", admin: false },
    { id: "m0000000-0000-0000-0000-000000000004", name: "Lukas", admin: false },
  ];

  for (const m of members) {
    await sql`
      INSERT INTO group_members (id, group_id, display_name, is_admin)
      VALUES (${m.id}, ${groupId}, ${m.name}, ${m.admin})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  // 3. Event
  const eventId = "e0000000-0000-0000-0000-000000000001";
  await sql`
    INSERT INTO events (id, group_id, title, type, status, location, date_from, date_to)
    VALUES (
      ${eventId},
      ${groupId},
      'Belek Golf Trip 2025',
      'trip',
      'planning',
      'Belek, Turkey',
      '2025-09-15',
      '2025-09-22'
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // 4. Event modules
  const moduleTypes = ["participant_form", "packages", "golf"];
  for (let i = 0; i < moduleTypes.length; i++) {
    await sql`
      INSERT INTO event_modules (event_id, type, sort_order, active)
      VALUES (${eventId}, ${moduleTypes[i]}, ${i}, true)
      ON CONFLICT DO NOTHING
    `;
  }

  // 5. Packages
  const packages = [
    { name: "Standard", price: 1490, desc: "Standard hotel room, breakfast included" },
    { name: "Superior", price: 1690, desc: "Superior room with sea view, all-inclusive" },
    { name: "Golf Package", price: 1990, desc: "Superior room, all-inclusive, 5x green fees" },
  ];

  for (let i = 0; i < packages.length; i++) {
    await sql`
      INSERT INTO trip_packages (event_id, name, description, price_chf, sort_order)
      VALUES (${eventId}, ${packages[i].name}, ${packages[i].desc}, ${packages[i].price}, ${i})
      ON CONFLICT DO NOTHING
    `;
  }

  // 6. Golf course
  const courseId = "c0000000-0000-0000-0000-000000000001";
  await sql`
    INSERT INTO golf_courses (id, name, location, country, total_holes, par_total, course_rating, slope_rating)
    VALUES (
      ${courseId},
      'Carya Golf Club',
      'Belek',
      'Turkey',
      18,
      72,
      73.1,
      133
    )
    ON CONFLICT (id) DO NOTHING
  `;

  // Hole data for Carya Golf Club (typical par distribution)
  const pars = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
  const distances = [370, 510, 175, 395, 420, 160, 380, 530, 400, 385, 190, 520, 360, 410, 165, 405, 540, 390];
  const handicaps = [7, 3, 15, 5, 1, 17, 9, 11, 13, 8, 16, 2, 12, 4, 18, 6, 10, 14];

  for (let hole = 1; hole <= 18; hole++) {
    await sql`
      INSERT INTO golf_course_holes (course_id, hole_number, par, distance_m, handicap_index)
      VALUES (${courseId}, ${hole}, ${pars[hole - 1]}, ${distances[hole - 1]}, ${handicaps[hole - 1]})
      ON CONFLICT (course_id, hole_number) DO NOTHING
    `;
  }

  console.log("Seed complete.");
  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
