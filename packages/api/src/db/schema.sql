-- Crew App — Full Database Schema (Staging)
-- Generated from crew-final.md

BEGIN;

-- ============================================
-- CORE: Groups & Members
-- ============================================

CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  cover_image TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID REFERENCES groups(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  avatar_emoji TEXT,
  is_admin     BOOLEAN DEFAULT FALSE,
  joined_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CORE: Events & Modules
-- ============================================

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID REFERENCES groups(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  date_from   DATE,
  date_to     DATE,
  location    TEXT,
  cover_image TEXT,
  status      TEXT DEFAULT 'planning',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  config     JSONB DEFAULT '{}',
  sort_order INT DEFAULT 0,
  active     BOOLEAN DEFAULT TRUE
);

-- ============================================
-- PRE-TRIP: Participant Forms
-- ============================================

CREATE TABLE IF NOT EXISTS participant_forms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES group_members(id) ON DELETE CASCADE,
  data         JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ
);

-- ============================================
-- PRE-TRIP: Packages
-- ============================================

CREATE TABLE IF NOT EXISTS trip_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT,
  description TEXT,
  price_chf   FLOAT,
  includes    JSONB,
  capacity    INT,
  sort_order  INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS participant_packages (
  participant_id UUID REFERENCES participant_forms(id) ON DELETE CASCADE,
  package_id     UUID REFERENCES trip_packages(id) ON DELETE CASCADE,
  confirmed      BOOLEAN DEFAULT FALSE,
  confirmed_at   TIMESTAMPTZ,
  PRIMARY KEY (participant_id, package_id)
);

-- ============================================
-- PRE-TRIP: Flights
-- ============================================

CREATE TABLE IF NOT EXISTS flights (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID REFERENCES events(id) ON DELETE CASCADE,
  direction         TEXT,
  airline           TEXT,
  flight_number     TEXT,
  departure_airport TEXT,
  arrival_airport   TEXT,
  departure_time    TIMESTAMPTZ,
  arrival_time      TIMESTAMPTZ,
  booking_ref       TEXT
);

CREATE TABLE IF NOT EXISTS participant_flights (
  participant_id UUID REFERENCES participant_forms(id) ON DELETE CASCADE,
  flight_id      UUID REFERENCES flights(id) ON DELETE CASCADE,
  seat           TEXT,
  baggage        TEXT,
  PRIMARY KEY (participant_id, flight_id)
);

-- ============================================
-- PRE-TRIP: Extras
-- ============================================

CREATE TABLE IF NOT EXISTS trip_extras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT,
  type        TEXT,
  date        DATE,
  price_chf   FLOAT,
  capacity    INT,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS participant_extras (
  participant_id UUID REFERENCES participant_forms(id) ON DELETE CASCADE,
  extra_id       UUID REFERENCES trip_extras(id) ON DELETE CASCADE,
  quantity       INT DEFAULT 1,
  confirmed      BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (participant_id, extra_id)
);

-- ============================================
-- PRE-TRIP: Rooms
-- ============================================

CREATE TABLE IF NOT EXISTS rooms (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  number    TEXT,
  type      TEXT,
  notes     TEXT
);

CREATE TABLE IF NOT EXISTS room_assignments (
  room_id        UUID REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participant_forms(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, participant_id)
);

-- ============================================
-- PRE-TRIP: Checklists
-- ============================================

CREATE TABLE IF NOT EXISTS checklist_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  label      TEXT,
  category   TEXT,
  required   BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_checks (
  item_id   UUID REFERENCES checklist_items(id) ON DELETE CASCADE,
  member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  checked   BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (item_id, member_id)
);

-- ============================================
-- PRE-TRIP: Reminders
-- ============================================

CREATE TABLE IF NOT EXISTS reminders (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  type      TEXT,
  message   TEXT,
  send_at   TIMESTAMPTZ,
  target    TEXT,
  sent      BOOLEAN DEFAULT FALSE
);

-- ============================================
-- ON-TRIP: Golf
-- ============================================

CREATE TABLE IF NOT EXISTS golf_courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  location       TEXT,
  country        TEXT,
  total_holes    INT DEFAULT 18,
  par_total      INT,
  course_rating  FLOAT,
  slope_rating   INT,
  length_meters  INT,
  source         TEXT
);

CREATE TABLE IF NOT EXISTS golf_course_holes (
  course_id      UUID REFERENCES golf_courses(id) ON DELETE CASCADE,
  hole_number    INT,
  par            INT,
  distance_m     INT,
  handicap_index INT,
  PRIMARY KEY (course_id, hole_number)
);

CREATE TABLE IF NOT EXISTS golf_rounds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES golf_courses(id),
  format      TEXT DEFAULT 'stableford',
  date        DATE,
  tee_time    TIME
);

CREATE TABLE IF NOT EXISTS golf_player_handicaps (
  member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  handicap  FLOAT,
  PRIMARY KEY (member_id, event_id)
);

CREATE TABLE IF NOT EXISTS golf_scores (
  round_id   UUID REFERENCES golf_rounds(id) ON DELETE CASCADE,
  member_id  UUID REFERENCES group_members(id) ON DELETE CASCADE,
  hole       INT,
  strokes    INT,
  putts      INT,
  net_score  INT,
  stableford INT,
  PRIMARY KEY (round_id, member_id, hole)
);

-- ============================================
-- ON-TRIP: Ski
-- ============================================

CREATE TABLE IF NOT EXISTS ski_resorts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,
  country    TEXT,
  region     TEXT,
  total_km   INT,
  vertical_m INT
);

CREATE TABLE IF NOT EXISTS ski_day_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES group_members(id) ON DELETE CASCADE,
  date        DATE,
  resort_id   UUID REFERENCES ski_resorts(id),
  km_skied    FLOAT,
  vertical_m  INT,
  runs_count  INT,
  notes       TEXT
);

-- ============================================
-- ON-TRIP: Poker
-- ============================================

CREATE TABLE IF NOT EXISTS poker_tournaments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID REFERENCES events(id) ON DELETE CASCADE,
  format         TEXT DEFAULT 'freezeout',
  buy_in_chf     FLOAT,
  starting_chips INT DEFAULT 10000,
  rebuy_allowed  BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS poker_players (
  tournament_id UUID REFERENCES poker_tournaments(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES group_members(id) ON DELETE CASCADE,
  current_chips INT,
  status        TEXT DEFAULT 'active',
  position      INT,
  eliminated_by UUID REFERENCES group_members(id),
  prize_chf     FLOAT,
  PRIMARY KEY (tournament_id, member_id)
);

-- ============================================
-- ON-TRIP: Darts
-- ============================================

CREATE TABLE IF NOT EXISTS darts_matches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  mode       TEXT,
  player1_id UUID REFERENCES group_members(id),
  player2_id UUID REFERENCES group_members(id),
  winner_id  UUID REFERENCES group_members(id)
);

CREATE TABLE IF NOT EXISTS darts_throws (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id  UUID REFERENCES darts_matches(id) ON DELETE CASCADE,
  player_id UUID REFERENCES group_members(id),
  leg       INT,
  throw_num INT,
  score     INT,
  remaining INT,
  checkout  BOOLEAN DEFAULT FALSE
);

-- ============================================
-- ON-TRIP: Bowling
-- ============================================

CREATE TABLE IF NOT EXISTS bowling_games (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  date     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bowling_scores (
  game_id   UUID REFERENCES bowling_games(id) ON DELETE CASCADE,
  member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  frames    JSONB,
  total     INT,
  PRIMARY KEY (game_id, member_id)
);

-- ============================================
-- ON-TRIP: Padel / Tennis
-- ============================================

CREATE TABLE IF NOT EXISTS padel_tournaments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  format   TEXT
);

CREATE TABLE IF NOT EXISTS padel_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES padel_tournaments(id) ON DELETE CASCADE,
  team1_p1      UUID REFERENCES group_members(id),
  team1_p2      UUID REFERENCES group_members(id),
  team2_p1      UUID REFERENCES group_members(id),
  team2_p2      UUID REFERENCES group_members(id),
  sets          JSONB,
  winner_team   INT
);

-- ============================================
-- ON-TRIP: Kart Racing
-- ============================================

CREATE TABLE IF NOT EXISTS kart_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  session_type TEXT,
  track_name   TEXT,
  laps_total   INT
);

CREATE TABLE IF NOT EXISTS kart_results (
  session_id    UUID REFERENCES kart_sessions(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES group_members(id) ON DELETE CASCADE,
  position      INT,
  best_lap_ms   INT,
  total_time_ms INT,
  penalties_s   INT DEFAULT 0,
  PRIMARY KEY (session_id, member_id)
);

-- ============================================
-- ON-TRIP: Fitness Challenge
-- ============================================

CREATE TABLE IF NOT EXISTS fitness_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id) ON DELETE CASCADE,
  title      TEXT,
  metric     TEXT,
  lower_wins BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS fitness_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES fitness_challenges(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES group_members(id) ON DELETE CASCADE,
  value        FLOAT,
  video_url    TEXT,
  verified_by  UUID REFERENCES group_members(id)
);

-- ============================================
-- ON-TRIP: Predictions (Tipp-Spiel)
-- ============================================

CREATE TABLE IF NOT EXISTS predictions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  title     TEXT,
  options   JSONB,
  closes_at TIMESTAMPTZ,
  result_id TEXT
);

CREATE TABLE IF NOT EXISTS prediction_picks (
  prediction_id UUID REFERENCES predictions(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES group_members(id) ON DELETE CASCADE,
  option_id     TEXT,
  PRIMARY KEY (prediction_id, member_id)
);

-- ============================================
-- ON-TRIP: Cooking / BBQ
-- ============================================

CREATE TABLE IF NOT EXISTS cooking_challenges (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  category TEXT,
  theme    TEXT
);

CREATE TABLE IF NOT EXISTS cooking_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES cooking_challenges(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES group_members(id) ON DELETE CASCADE,
  dish_name    TEXT,
  photo_url    TEXT
);

CREATE TABLE IF NOT EXISTS cooking_ratings (
  entry_id UUID REFERENCES cooking_entries(id) ON DELETE CASCADE,
  rater_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  taste    INT,
  look     INT,
  original INT,
  PRIMARY KEY (entry_id, rater_id)
);

-- ============================================
-- ON-TRIP: Custom Leaderboard
-- ============================================

CREATE TABLE IF NOT EXISTS custom_leaderboard (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id) ON DELETE CASCADE,
  module_id UUID REFERENCES event_modules(id) ON DELETE CASCADE,
  member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  value     FLOAT,
  label     TEXT
);

-- ============================================
-- META: Bets (Wetten)
-- ============================================

CREATE TABLE IF NOT EXISTS bets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  module_id   UUID REFERENCES event_modules(id),
  created_by  UUID REFERENCES group_members(id),
  type        TEXT,
  title       TEXT,
  stake       TEXT,
  status      TEXT DEFAULT 'open',
  winner_id   UUID REFERENCES group_members(id),
  settled_by  UUID REFERENCES group_members(id)
);

CREATE TABLE IF NOT EXISTS bet_participants (
  bet_id    UUID REFERENCES bets(id) ON DELETE CASCADE,
  member_id UUID REFERENCES group_members(id) ON DELETE CASCADE,
  side      TEXT,
  accepted  BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (bet_id, member_id)
);

-- ============================================
-- COMMUNICATION: Chat
-- ============================================

CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID REFERENCES groups(id) ON DELETE CASCADE,
  event_id   UUID REFERENCES events(id) ON DELETE SET NULL,
  sender_id  UUID REFERENCES group_members(id) ON DELETE SET NULL,
  content    TEXT,
  type       TEXT DEFAULT 'text',
  media_url  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- COMMUNICATION: Media
-- ============================================

CREATE TABLE IF NOT EXISTS media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  uploader_id UUID REFERENCES group_members(id) ON DELETE SET NULL,
  url         TEXT NOT NULL,
  thumbnail   TEXT,
  type        TEXT DEFAULT 'image',
  likes       INT DEFAULT 0,
  caption     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- B2B: Agencies (Phase 2)
-- ============================================

CREATE TABLE IF NOT EXISTS agencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  logo_url    TEXT,
  brand_color TEXT,
  plan        TEXT
);

CREATE TABLE IF NOT EXISTS agency_events (
  agency_id   UUID REFERENCES agencies(id) ON DELETE CASCADE,
  event_id    UUID REFERENCES events(id) ON DELETE CASCADE,
  client_name TEXT,
  PRIMARY KEY (agency_id, event_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_events_group ON events(group_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_event_modules_event ON event_modules(event_id);
CREATE INDEX IF NOT EXISTS idx_participant_forms_event ON participant_forms(event_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_media_event ON media(event_id);
CREATE INDEX IF NOT EXISTS idx_golf_scores_round ON golf_scores(round_id);
CREATE INDEX IF NOT EXISTS idx_bets_event ON bets(event_id);

COMMIT;
