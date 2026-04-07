// Realistic demo data for when the API backend is not running

export const MOCK_MEMBERS = [
  { id: "m1", display_name: "Mathias Graf", avatar_emoji: "🏌️", is_admin: true },
  { id: "m2", display_name: "Benjamin Konzett", avatar_emoji: "🦅", is_admin: false },
  { id: "m3", display_name: "Lukas Meier", avatar_emoji: "🔥", is_admin: false },
  { id: "m4", display_name: "Daniel Huber", avatar_emoji: "⛳", is_admin: false },
  { id: "m5", display_name: "Marco Steiner", avatar_emoji: "🏆", is_admin: false },
  { id: "m6", display_name: "Patrick Brunner", avatar_emoji: "💪", is_admin: false },
  { id: "m7", display_name: "Stefan Fischer", avatar_emoji: "🎯", is_admin: false },
  { id: "m8", display_name: "Thomas Keller", avatar_emoji: "⚡", is_admin: false },
  { id: "m9", display_name: "Andreas Berger", avatar_emoji: "🦁", is_admin: false },
  { id: "m10", display_name: "Christian Müller", avatar_emoji: "🐺", is_admin: false },
];

export const MOCK_ROUNDS = [
  { id: "r1", date: "2026-04-08", course_name: "Cornelia Golf Club – Faldo Course", tee_time: "08:30:00", par_total: 72, format: "stableford", players_scored: 8, notes: "Erstes Turnier — Eingewöhnungsrunde" },
  { id: "r2", date: "2026-04-09", course_name: "Cornelia Golf Club – Nick Faldo", tee_time: "09:00:00", par_total: 72, format: "stableford", players_scored: 10, notes: null },
  { id: "r3", date: "2026-04-10", course_name: "Montgomerie Maxx Royal", tee_time: "08:00:00", par_total: 72, format: "stableford", players_scored: 9, notes: "Transferbus 07:15 Lobby" },
  { id: "r4", date: "2026-04-11", course_name: "Carya Golf Club", tee_time: "10:00:00", par_total: 72, format: "stableford", players_scored: 7, notes: null },
  { id: "r5", date: "2026-04-12", course_name: "Cornelia Golf Club – Faldo Course", tee_time: "08:30:00", par_total: 72, format: "stableford", players_scored: 0, notes: null },
  { id: "r6", date: "2026-04-13", course_name: "Sultan Golf Course", tee_time: "09:30:00", par_total: 72, format: "stableford", players_scored: 0, notes: "Ruhetag möglich" },
  { id: "r7", date: "2026-04-14", course_name: "Cornelia Golf Club – Faldo Course", tee_time: "08:00:00", par_total: 72, format: "stableford", players_scored: 0, notes: "Finalrunde — Last day!" },
];

export const MOCK_LEADERBOARD = [
  { member_id: "m3", display_name: "Lukas Meier", avatar_emoji: "🔥", total_points: 142, total_strokes: 298, rounds_played: 4 },
  { member_id: "m2", display_name: "Benjamin Konzett", avatar_emoji: "🦅", total_points: 138, total_strokes: 305, rounds_played: 4 },
  { member_id: "m5", display_name: "Marco Steiner", avatar_emoji: "🏆", total_points: 131, total_strokes: 312, rounds_played: 4 },
  { member_id: "m1", display_name: "Mathias Graf", avatar_emoji: "🏌️", total_points: 128, total_strokes: 318, rounds_played: 4 },
  { member_id: "m4", display_name: "Daniel Huber", avatar_emoji: "⛳", total_points: 125, total_strokes: 320, rounds_played: 4 },
  { member_id: "m7", display_name: "Stefan Fischer", avatar_emoji: "🎯", total_points: 119, total_strokes: 328, rounds_played: 4 },
  { member_id: "m6", display_name: "Patrick Brunner", avatar_emoji: "💪", total_points: 115, total_strokes: 332, rounds_played: 3 },
  { member_id: "m8", display_name: "Thomas Keller", avatar_emoji: "⚡", total_points: 108, total_strokes: 340, rounds_played: 4 },
  { member_id: "m9", display_name: "Andreas Berger", avatar_emoji: "🦁", total_points: 102, total_strokes: 348, rounds_played: 3 },
  { member_id: "m10", display_name: "Christian Müller", avatar_emoji: "🐺", total_points: 95, total_strokes: 355, rounds_played: 3 },
];

export const MOCK_MESSAGES = [
  { id: "msg1", sender_id: "m2", sender_name: "Benjamin Konzett", sender_emoji: "🦅", content: "Hey Jungs! Morgen 07:15 Lobby für den Transferbus zum Montgomerie. Nicht verschlafen! 😄", created_at: "2026-04-09T20:30:00Z" },
  { id: "msg2", sender_id: "m3", sender_name: "Lukas Meier", sender_emoji: "🔥", content: "Bin ready! Heute war mega geil auf dem Faldo Course 🔥", created_at: "2026-04-09T20:32:00Z" },
  { id: "msg3", sender_id: "m1", sender_name: "Mathias Graf", sender_emoji: "🏌️", content: "Was ein Tag. 34 Stableford Punkte, neuer Bestwert!", created_at: "2026-04-09T20:35:00Z" },
  { id: "msg4", sender_id: "m5", sender_name: "Marco Steiner", sender_emoji: "🏆", content: "Glückwunsch! Ich hatte leider 3 Doppelbogeys auf der Back 9... 😩", created_at: "2026-04-09T20:36:00Z" },
  { id: "msg5", sender_id: "m4", sender_name: "Daniel Huber", sender_emoji: "⛳", content: "Hat jemand mein Pitchgabel gesehen? Glaube habs am 14. Grün vergessen", created_at: "2026-04-09T20:40:00Z" },
  { id: "msg6", sender_id: "m6", sender_name: "Patrick Brunner", sender_emoji: "💪", content: "Liegt an der Rezeption, hab's abgegeben 👍", created_at: "2026-04-09T20:42:00Z" },
  { id: "msg7", sender_id: "m7", sender_name: "Stefan Fischer", sender_emoji: "🎯", content: "Wer ist heute Abend beim Poker dabei? Starship Lounge, 21 Uhr", created_at: "2026-04-09T21:00:00Z" },
  { id: "msg8", sender_id: "m8", sender_name: "Thomas Keller", sender_emoji: "⚡", content: "Dabei! 🃏", created_at: "2026-04-09T21:01:00Z" },
  { id: "msg9", sender_id: "m1", sender_name: "Mathias Graf", sender_emoji: "🏌️", content: "Bin auch dabei. Aber Einsatz max 20 CHF 😂", created_at: "2026-04-09T21:05:00Z" },
  { id: "msg10", sender_id: "m2", sender_name: "Benjamin Konzett", sender_emoji: "🦅", content: "Reminder: Masters Pool Deadline ist übermorgen! Wer noch kein Team hat → Link in der App unter Mehr > Masters", created_at: "2026-04-09T21:15:00Z" },
  { id: "msg11", sender_id: "m9", sender_name: "Andreas Berger", sender_emoji: "🦁", content: "Das All-Inclusive Buffet heute Abend ist der Hammer. Empfehle das Lammkarree!", created_at: "2026-04-09T21:30:00Z" },
  { id: "msg12", sender_id: "m3", sender_name: "Lukas Meier", sender_emoji: "🔥", content: "Morgen Carya Golf Club! Das soll einer der besten Plätze in Belek sein 💪", created_at: "2026-04-10T07:45:00Z" },
  { id: "msg13", sender_id: "m10", sender_name: "Christian Müller", sender_emoji: "🐺", content: "Hab den Wecker gestellt. Diesmal komm ich nicht zu spät zum Bus 🤞", created_at: "2026-04-10T07:50:00Z" },
  { id: "msg14", sender_id: "m4", sender_name: "Daniel Huber", sender_emoji: "⛳", content: "Haha Christian, gestern warst du 10 Minuten zu spät 😂😂", created_at: "2026-04-10T07:52:00Z" },
  { id: "msg15", sender_id: "m1", sender_name: "Mathias Graf", sender_emoji: "🏌️", content: "Let's go boys! 🏌️‍♂️ Heute hol ich mir die Führung!", created_at: "2026-04-10T08:00:00Z" },
];

export const MOCK_FLIGHTS = {
  flights: [
    {
      id: "f1",
      direction: "outbound",
      flight_number: "LX 1810",
      airline: "Swiss",
      departure_airport: "ZRH",
      arrival_airport: "AYT",
      departure_time: "2026-04-08T06:25:00Z",
      arrival_time: "2026-04-08T10:50:00Z",
      passengers: [
        { member_id: "m1", display_name: "Mathias Graf" },
        { member_id: "m2", display_name: "Benjamin Konzett" },
        { member_id: "m3", display_name: "Lukas Meier" },
        { member_id: "m4", display_name: "Daniel Huber" },
        { member_id: "m5", display_name: "Marco Steiner" },
      ],
    },
    {
      id: "f2",
      direction: "outbound",
      flight_number: "TK 1914",
      airline: "Turkish Airlines",
      departure_airport: "ZRH",
      arrival_airport: "AYT",
      departure_time: "2026-04-08T08:15:00Z",
      arrival_time: "2026-04-08T12:40:00Z",
      passengers: [
        { member_id: "m6", display_name: "Patrick Brunner" },
        { member_id: "m7", display_name: "Stefan Fischer" },
        { member_id: "m8", display_name: "Thomas Keller" },
        { member_id: "m9", display_name: "Andreas Berger" },
        { member_id: "m10", display_name: "Christian Müller" },
      ],
    },
    {
      id: "f3",
      direction: "return",
      flight_number: "LX 1811",
      airline: "Swiss",
      departure_airport: "AYT",
      arrival_airport: "ZRH",
      departure_time: "2026-04-15T11:30:00Z",
      arrival_time: "2026-04-15T14:00:00Z",
      passengers: [
        { member_id: "m1", display_name: "Mathias Graf" },
        { member_id: "m2", display_name: "Benjamin Konzett" },
        { member_id: "m3", display_name: "Lukas Meier" },
        { member_id: "m4", display_name: "Daniel Huber" },
        { member_id: "m5", display_name: "Marco Steiner" },
        { member_id: "m6", display_name: "Patrick Brunner" },
      ],
    },
    {
      id: "f4",
      direction: "return",
      flight_number: "PC 555",
      airline: "Pegasus",
      departure_airport: "AYT",
      arrival_airport: "ZRH",
      departure_time: "2026-04-15T16:45:00Z",
      arrival_time: "2026-04-15T19:15:00Z",
      passengers: [
        { member_id: "m7", display_name: "Stefan Fischer" },
        { member_id: "m8", display_name: "Thomas Keller" },
        { member_id: "m9", display_name: "Andreas Berger" },
        { member_id: "m10", display_name: "Christian Müller" },
      ],
    },
  ],
};

export const MOCK_GOLF_DATA = {
  rounds: MOCK_ROUNDS,
  leaderboard: MOCK_LEADERBOARD,
};

export const MOCK_HOLES = Array.from({ length: 18 }, (_, i) => ({
  hole_number: i + 1,
  par: [4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4][i],
  distance_m: [380, 165, 510, 395, 345, 185, 490, 360, 410, 370, 175, 520, 385, 400, 155, 415, 505, 430][i],
  handicap_index: [7, 15, 3, 5, 11, 17, 1, 9, 13, 8, 16, 2, 6, 10, 18, 4, 12, 14][i],
}));

// Generate realistic scores for a round
function generateScores(roundId: string, members: typeof MOCK_MEMBERS) {
  const scores: any[] = [];
  members.forEach((m) => {
    MOCK_HOLES.forEach((hole) => {
      const handicapAllowance = Math.floor(18 / hole.handicap_index);
      const base = hole.par + (Math.random() > 0.5 ? 1 : 0) + (Math.random() > 0.7 ? 1 : 0);
      const strokes = Math.max(1, Math.round(base - (Math.random() > 0.6 ? 1 : 0)));
      const netStrokes = strokes - handicapAllowance;
      const stableford = Math.max(0, 2 + (hole.par - netStrokes));
      scores.push({
        member_id: m.id,
        round_id: roundId,
        hole: hole.hole_number,
        strokes,
        stableford: Math.min(stableford, 5),
      });
    });
  });
  return scores;
}

export const MOCK_ROUND_DETAIL = {
  round: MOCK_ROUNDS[0],
  holes: MOCK_HOLES,
  scores: generateScores("r1", MOCK_MEMBERS),
  members: MOCK_MEMBERS,
};

export const MOCK_LOCATIONS = [
  { member_id: "m2", display_name: "Benjamin Konzett", avatar_emoji: "🦅", lat: 36.8621, lng: 30.9866, updated_at: new Date(Date.now() - 15 * 60000).toISOString() },
  { member_id: "m3", display_name: "Lukas Meier", avatar_emoji: "🔥", lat: 36.8595, lng: 30.9912, updated_at: new Date(Date.now() - 45 * 60000).toISOString() },
  { member_id: "m5", display_name: "Marco Steiner", avatar_emoji: "🏆", lat: 36.8640, lng: 30.9840, updated_at: new Date(Date.now() - 5 * 60000).toISOString() },
];
