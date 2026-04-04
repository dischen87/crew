# Crew App — Finale Architektur

> Ersetzt WhatsApp + E-Mail für Gruppenreisen und Events.  
> Modular aufgebaut — jeder Trip, jeder Anlass, jede Gruppe.

---

## Vision

```
PRE-TRIP              ON-TRIP               POST-TRIP
────────────          ──────────────         ─────────────
Daten sammeln    →    Aktivitäten       →    Recap & Memory
Packages wählen       Golf / Poker           Highlights
Flug erfassen         Chat                   Galerie
Extras buchen         Wetten                 Teilen
```

**B2C:** Freundesgruppe organisiert sich selbst  
**B2B:** Reisebüro oder Veranstalter managed für Kunden

---

## Rollen

| Rolle | Rechte |
|---|---|
| **Event Master** | Erstellt Trip, konfiguriert Module, verwaltet Teilnehmer, löst Wetten auf |
| **Participant** | Füllt eigene Daten aus, nimmt an Aktivitäten teil |
| **Agency Admin** *(B2B)* | Managed mehrere Events / Gruppen gleichzeitig |

---

## Tech Stack

| Layer | Tech |
|---|---|
| Mobile | React Native + Expo |
| API | Bun + Hono |
| Pattern | Server-Driven UI (`/v2/event/:id`) |
| Datenbank | PostgreSQL |
| Real-time | Hono WebSocket + Redis Pub/Sub |
| Medien | Hetzner Object Storage (S3) |
| Push | Expo Push API + BullMQ/Redis |
| Jobs | Windmill |
| Auth | Magic Link / Invite Code |

---

## Kern-Datenmodell

```sql
-- Gruppen & Members
CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  cover_image TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID REFERENCES groups(id),
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  avatar_emoji TEXT,
  is_admin     BOOLEAN DEFAULT FALSE,
  joined_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Events
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID REFERENCES groups(id),
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,        -- 'trip' | 'golf' | 'ski' | 'generic'
  date_from   DATE,
  date_to     DATE,
  location    TEXT,
  cover_image TEXT,
  status      TEXT DEFAULT 'planning',  -- 'planning' | 'active' | 'completed'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Module (erweiterbar)
CREATE TABLE event_modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id),
  type       TEXT NOT NULL,        -- siehe Modul-Liste unten
  config     JSONB DEFAULT '{}',
  sort_order INT DEFAULT 0,
  active     BOOLEAN DEFAULT TRUE
);
```

---

## Modul-System

### Prinzip

Jeder Event besteht aus beliebig kombinierbaren Modulen.  
Event Master wählt Module beim Erstellen — oder fügt sie später hinzu.  
Neue Module brauchen kein App-Update (SDUI).

```
event_modules.type  →  React Native Komponente
```

---

## PRE-TRIP Module

### Modul: Teilnehmer-Formular

Event Master definiert welche Felder er braucht.  
Participants füllen ihr eigenes Formular aus — Schritt für Schritt (Wizard).

**Konfigurierbare Felder:**

```json
{
  "type": "participant_form",
  "config": {
    "fields": [
      { "id": "first_name",      "label": "Vorname",           "required": true },
      { "id": "last_name",       "label": "Nachname",          "required": true },
      { "id": "birth_date",      "label": "Geburtsdatum",      "required": false },
      { "id": "nationality",     "label": "Nationalität",      "required": false },
      { "id": "phone",           "label": "Mobilnummer",       "required": false },
      { "id": "dietary_needs",   "label": "Diät / Allergien",  "required": false },
      { "id": "shirt_size",      "label": "T-Shirt Grösse",    "required": false },
      { "id": "shoe_size",       "label": "Schuhgrösse",       "required": false },
      { "id": "golf_handicap",   "label": "Golf Handicap",     "required": false },
      { "id": "emergency_name",  "label": "Notfallkontakt",    "required": false },
      { "id": "emergency_phone", "label": "Notfall Telefon",   "required": false }
    ]
  }
}
```

```sql
CREATE TABLE participant_forms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  member_id   UUID REFERENCES group_members(id),
  data        JSONB DEFAULT '{}',   -- { "first_name": "Mathias", "handicap": 12.4 }
  status      TEXT DEFAULT 'pending',  -- 'pending' | 'partial' | 'complete'
  submitted_at TIMESTAMPTZ
);
```

---

### Modul: Packages

Event Master legt verfügbare Packages an. Jeder Participant wählt seines.

```sql
CREATE TABLE trip_packages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  name        TEXT,
  description TEXT,
  price_chf   FLOAT,
  includes    JSONB,      -- ["7 Nächte", "All-Inclusive", "3x Golf"]
  capacity    INT,
  sort_order  INT DEFAULT 0
);

CREATE TABLE participant_packages (
  participant_id UUID REFERENCES participant_forms(id),
  package_id     UUID REFERENCES trip_packages(id),
  confirmed      BOOLEAN DEFAULT FALSE,
  confirmed_at   TIMESTAMPTZ,
  PRIMARY KEY (participant_id, package_id)
);
```

**Beispiel Belek:**
```
Package A  Standard          All-Inclusive, 7 Nächte            CHF 1'490
Package B  Superior Room     All-Inclusive, Superior, 7 Nächte  CHF 1'690
Package C  Golf Package      All-Inclusive + 3x Golf            CHF 1'990
```

---

### Modul: Flug

Jeder Teilnehmer erfasst seinen Flug. Event Master kann Gruppenflüge anlegen.

```sql
CREATE TABLE flights (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID REFERENCES events(id),
  direction         TEXT,        -- 'outbound' | 'return'
  airline           TEXT,
  flight_number     TEXT,
  departure_airport TEXT,
  arrival_airport   TEXT,
  departure_time    TIMESTAMPTZ,
  arrival_time      TIMESTAMPTZ,
  booking_ref       TEXT
);

CREATE TABLE participant_flights (
  participant_id UUID REFERENCES participant_forms(id),
  flight_id      UUID REFERENCES flights(id),
  seat           TEXT,
  baggage        TEXT,
  PRIMARY KEY (participant_id, flight_id)
);
```

---

### Modul: Extras & Zusatzleistungen

Event Master definiert buchbare Extras. Participants buchen selbst.

```sql
CREATE TABLE trip_extras (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  name        TEXT,
  type        TEXT,      -- 'golf' | 'spa' | 'excursion' | 'transfer' | 'other'
  date        DATE,
  price_chf   FLOAT,
  capacity    INT,
  notes       TEXT
);

CREATE TABLE participant_extras (
  participant_id UUID REFERENCES participant_forms(id),
  extra_id       UUID REFERENCES trip_extras(id),
  quantity       INT DEFAULT 1,
  confirmed      BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (participant_id, extra_id)
);
```

---

### Modul: Zimmer-Zuteilung

```sql
CREATE TABLE rooms (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id),
  number    TEXT,
  type      TEXT,   -- 'single' | 'double' | 'suite'
  notes     TEXT
);

CREATE TABLE room_assignments (
  room_id        UUID REFERENCES rooms(id),
  participant_id UUID REFERENCES participant_forms(id),
  PRIMARY KEY (room_id, participant_id)
);
```

---

### Modul: Checkliste

Packliste oder To-Dos. Jeder hakt individuell ab.

```sql
CREATE TABLE checklist_items (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id),
  label     TEXT,
  category  TEXT,   -- 'dokumente' | 'kleidung' | 'sport' | 'sonstiges'
  required  BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0
);

CREATE TABLE checklist_checks (
  item_id   UUID REFERENCES checklist_items(id),
  member_id UUID REFERENCES group_members(id),
  checked   BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (item_id, member_id)
);
```

---

### Modul: Reminders

Event Master setzt automatische Erinnerungen (via Windmill).

```sql
CREATE TABLE reminders (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id),
  type      TEXT,      -- 'form_incomplete' | 'payment_due' | 'custom'
  message   TEXT,
  send_at   TIMESTAMPTZ,
  target    TEXT,      -- 'all' | 'pending_only'
  sent      BOOLEAN DEFAULT FALSE
);
```

---

## ON-TRIP Module

### Modul: Golf 🏌️

#### Golfplatz-Import (The Golf API)

```typescript
// Suche beim Event erstellen
GET https://api.thegolfapi.com/v1/courses?country=TR&near=Belek
```

```sql
CREATE TABLE golf_courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  location       TEXT,
  country        TEXT,
  total_holes    INT DEFAULT 18,
  par_total      INT,
  course_rating  FLOAT,
  slope_rating   INT,
  length_meters  INT,
  source         TEXT   -- 'api' | 'manual'
);

CREATE TABLE golf_course_holes (
  course_id      UUID REFERENCES golf_courses(id),
  hole_number    INT,
  par            INT,
  distance_m     INT,
  handicap_index INT,
  PRIMARY KEY (course_id, hole_number)
);

CREATE TABLE golf_rounds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  course_id   UUID REFERENCES golf_courses(id),
  format      TEXT DEFAULT 'stableford',  -- 'stableford' | 'strokeplay' | 'matchplay'
  date        DATE,
  tee_time    TIME
);

CREATE TABLE golf_player_handicaps (
  member_id UUID REFERENCES group_members(id),
  event_id  UUID REFERENCES events(id),
  handicap  FLOAT,
  PRIMARY KEY (member_id, event_id)
);

CREATE TABLE golf_scores (
  round_id   UUID REFERENCES golf_rounds(id),
  member_id  UUID REFERENCES group_members(id),
  hole       INT,
  strokes    INT,
  putts      INT,
  net_score  INT,    -- berechnet
  stableford INT,    -- berechnet
  PRIMARY KEY (round_id, member_id, hole)
);
```

**Stableford-Berechnung (serverseitig):**

```typescript
function stablefordPoints(strokes: number, par: number, handicap: number, holeIndex: number): number {
  const strokesReceived = Math.floor(handicap / 18) + (holeIndex <= (handicap % 18) ? 1 : 0)
  const diff = par + strokesReceived - strokes
  if (diff >= 2) return 4
  if (diff === 1) return 3
  if (diff === 0) return 2
  if (diff === -1) return 1
  return 0
}
```

---

### Modul: Ski ⛷️

```sql
CREATE TABLE ski_resorts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,
  country    TEXT,
  region     TEXT,
  total_km   INT,
  vertical_m INT
);

CREATE TABLE ski_day_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  member_id   UUID REFERENCES group_members(id),
  date        DATE,
  resort_id   UUID REFERENCES ski_resorts(id),
  km_skied    FLOAT,
  vertical_m  INT,
  runs_count  INT,
  notes       TEXT
);
```

---

### Modul: Poker 🃏

```sql
CREATE TABLE poker_tournaments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID REFERENCES events(id),
  format         TEXT DEFAULT 'freezeout',
  buy_in_chf     FLOAT,
  starting_chips INT DEFAULT 10000,
  rebuy_allowed  BOOLEAN DEFAULT FALSE
);

CREATE TABLE poker_players (
  tournament_id UUID REFERENCES poker_tournaments(id),
  member_id     UUID REFERENCES group_members(id),
  current_chips INT,
  status        TEXT DEFAULT 'active',  -- 'active' | 'eliminated'
  position      INT,
  eliminated_by UUID REFERENCES group_members(id),
  prize_chf     FLOAT
);
```

---

### Modul: Darts 🎯

```sql
CREATE TABLE darts_matches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id),
  mode       TEXT,   -- '501' | '301' | 'cricket'
  player1_id UUID REFERENCES group_members(id),
  player2_id UUID REFERENCES group_members(id),
  winner_id  UUID REFERENCES group_members(id)
);

CREATE TABLE darts_throws (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id  UUID REFERENCES darts_matches(id),
  player_id UUID REFERENCES group_members(id),
  leg       INT,
  throw_num INT,
  score     INT,
  remaining INT,
  checkout  BOOLEAN DEFAULT FALSE
);
```

---

### Modul: Bowling 🎳

```sql
CREATE TABLE bowling_games (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  date     TIMESTAMPTZ
);

CREATE TABLE bowling_scores (
  game_id   UUID REFERENCES bowling_games(id),
  member_id UUID REFERENCES group_members(id),
  frames    JSONB,   -- [{t1: 7, t2: 2}, {t1: 10}, ...]
  total     INT,
  PRIMARY KEY (game_id, member_id)
);
```

---

### Modul: Padel / Tennis 🎾

```sql
CREATE TABLE padel_tournaments (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  format   TEXT   -- 'round_robin' | 'knockout'
);

CREATE TABLE padel_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES padel_tournaments(id),
  team1_p1      UUID REFERENCES group_members(id),
  team1_p2      UUID REFERENCES group_members(id),
  team2_p1      UUID REFERENCES group_members(id),
  team2_p2      UUID REFERENCES group_members(id),
  sets          JSONB,   -- [{t1: 6, t2: 4}, ...]
  winner_team   INT
);
```

---

### Modul: Kart Racing 🏎️

```sql
CREATE TABLE kart_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id),
  session_type TEXT,   -- 'qualifying' | 'race'
  track_name   TEXT,
  laps_total   INT
);

CREATE TABLE kart_results (
  session_id    UUID REFERENCES kart_sessions(id),
  member_id     UUID REFERENCES group_members(id),
  position      INT,
  best_lap_ms   INT,
  total_time_ms INT,
  penalties_s   INT DEFAULT 0,
  PRIMARY KEY (session_id, member_id)
);
```

---

### Modul: Fitness Challenge 💪

```sql
CREATE TABLE fitness_challenges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID REFERENCES events(id),
  title      TEXT,
  metric     TEXT,        -- 'reps' | 'seconds' | 'meters'
  lower_wins BOOLEAN DEFAULT FALSE
);

CREATE TABLE fitness_results (
  challenge_id UUID REFERENCES fitness_challenges(id),
  member_id    UUID REFERENCES group_members(id),
  value        FLOAT,
  video_url    TEXT,
  verified_by  UUID REFERENCES group_members(id)
);
```

---

### Modul: Tipp-Spiel 🔮

```sql
CREATE TABLE predictions (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id),
  title     TEXT,
  options   JSONB,     -- [{id: 'a', label: 'Mathias'}, ...]
  closes_at TIMESTAMPTZ,
  result_id TEXT
);

CREATE TABLE prediction_picks (
  prediction_id UUID REFERENCES predictions(id),
  member_id     UUID REFERENCES group_members(id),
  option_id     TEXT,
  PRIMARY KEY (prediction_id, member_id)
);
```

---

### Modul: Kochen / BBQ 🍖

```sql
CREATE TABLE cooking_challenges (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id),
  category TEXT,    -- 'main' | 'starter' | 'dessert' | 'cocktail'
  theme    TEXT
);

CREATE TABLE cooking_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID REFERENCES cooking_challenges(id),
  member_id    UUID REFERENCES group_members(id),
  dish_name    TEXT,
  photo_url    TEXT
);

CREATE TABLE cooking_ratings (
  entry_id UUID REFERENCES cooking_entries(id),
  rater_id UUID REFERENCES group_members(id),
  taste    INT,
  look     INT,
  original INT,
  PRIMARY KEY (entry_id, rater_id)
);
```

---

### Modul: Custom Leaderboard ⭐

Für alles was kein eigenes Modul hat. Event Master trägt Werte manuell ein.

```sql
CREATE TABLE custom_leaderboard (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID REFERENCES events(id),
  module_id UUID REFERENCES event_modules(id),
  member_id UUID REFERENCES group_members(id),
  value     FLOAT,
  label     TEXT
);
```

---

## Meta-Modul: Wetten 🎲

Quer über alle Module buchbar. Event Master löst auf.

```sql
CREATE TABLE bets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  module_id   UUID REFERENCES event_modules(id),
  created_by  UUID REFERENCES group_members(id),
  type        TEXT,    -- 'head_to_head' | 'prop_bet' | 'over_under' | 'forfeit'
  title       TEXT,
  stake       TEXT,    -- "1 Bier" | "CHF 20" | "zahlt Nachtessen"
  status      TEXT DEFAULT 'open',
  winner_id   UUID REFERENCES group_members(id),
  settled_by  UUID REFERENCES group_members(id)
);

CREATE TABLE bet_participants (
  bet_id    UUID REFERENCES bets(id),
  member_id UUID REFERENCES group_members(id),
  side      TEXT,
  accepted  BOOLEAN DEFAULT FALSE
);
```

---

## Kommunikation

### Chat (Gruppen + Event)

```sql
CREATE TABLE messages (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID REFERENCES groups(id),
  event_id  UUID REFERENCES events(id),  -- NULL = Gruppen-Chat
  sender_id UUID REFERENCES group_members(id),
  content   TEXT,
  type      TEXT DEFAULT 'text',   -- 'text' | 'image' | 'system'
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**WebSocket:** `WS /v2/chat/:group_id` via Hono + Redis Pub/Sub

---

### Medien

```sql
CREATE TABLE media (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES events(id),
  uploader_id UUID REFERENCES group_members(id),
  url         TEXT NOT NULL,
  thumbnail   TEXT,
  type        TEXT DEFAULT 'image',
  likes       INT DEFAULT 0,
  caption     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**Upload via Presigned URL** (kein Traffic durch API-Server)

---

## POST-TRIP: Recap

Windmill-Job nach `status = 'completed'`:

```json
{
  "screen": "recap",
  "highlights": [
    { "type": "winner",       "label": "Golf Gesamtsieger",    "member": "Mathias", "value": "47 Punkte" },
    { "type": "best_hole",    "label": "Bestes Loch",          "member": "Reto",    "value": "Birdie Loch 7" },
    { "type": "most_photos",  "label": "Meiste Fotos",         "member": "Adrian",  "value": "31 Fotos" },
    { "type": "top_bettor",   "label": "Bester Tipper",        "member": "Lukas",   "value": "4/5 Wetten gewonnen" }
  ],
  "gallery": { "top_photos": [...], "total": 87 },
  "shareable": true
}
```

---

## B2B-Erweiterung (Phase 2)

```sql
CREATE TABLE agencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT,
  logo_url    TEXT,
  brand_color TEXT,
  plan        TEXT   -- 'starter' | 'pro' | 'enterprise'
);

CREATE TABLE agency_events (
  agency_id   UUID REFERENCES agencies(id),
  event_id    UUID REFERENCES events(id),
  client_name TEXT
);
```

**B2B-Zusatz-Features:**
- Eigenes Branding (Logo / Farben)
- PDF-Export Teilnehmerliste für Hotel/Airline
- Buchungsübersicht exportieren
- Mehrere Events gleichzeitig verwalten

---

## API-Endpunkte

```
AUTH
POST /v2/auth/join            → Invite-Link einlösen

EVENTS
GET  /v2/group/:id            → Group-Home
GET  /v2/event/:id            → Event-Detail (SDUI)
POST /v2/event                → Event erstellen

PRE-TRIP
GET  /v2/event/:id/form       → Mein Formular
POST /v2/event/:id/form       → Formular speichern
POST /v2/event/:id/package    → Package wählen
POST /v2/event/:id/extras     → Extra buchen

ON-TRIP (Golf)
GET  /v2/event/:id/golf       → Golf-Screen (SDUI)
POST /v2/event/:id/golf/score → Score eintragen
GET  /v2/courses              → Golfplatz-Suche

MEDIA
POST /v2/event/:id/media/presign   → Presigned URL holen
POST /v2/event/:id/media/confirm   → Upload bestätigen

CHAT
WS   /v2/chat/:group_id            → WebSocket

EVENT MASTER
GET  /v2/event/:id/master          → Dashboard
POST /v2/event/:id/bets/:id/settle → Wette auflösen
POST /v2/event/:id/complete        → Event abschliessen
```

---

## Modul-Übersicht

| Modul | Phase | Wetten | Daten-Import |
|---|---|---|---|
| Teilnehmer-Formular | Pre-Trip | — | — |
| Packages | Pre-Trip | — | — |
| Flug | Pre-Trip | — | — |
| Extras | Pre-Trip | — | — |
| Zimmer | Pre-Trip | — | — |
| Checkliste | Pre-Trip | — | — |
| Golf 🏌️ | On-Trip | ✅ | Golf API |
| Ski ⛷️ | On-Trip | ✅ | Skiresort API |
| Poker 🃏 | On-Trip | ✅ | — |
| Darts 🎯 | On-Trip | ✅ | — |
| Bowling 🎳 | On-Trip | ✅ | — |
| Padel 🎾 | On-Trip | ✅ | — |
| Kart 🏎️ | On-Trip | ✅ | — |
| Fitness 💪 | On-Trip | ✅ | — |
| Tipp-Spiel 🔮 | On-Trip | — | — |
| Kochen/BBQ 🍖 | On-Trip | — | — |
| Custom Leaderboard ⭐ | On-Trip | ✅ | — |
| Chat | Both | — | — |
| Fotos | Both | — | — |
| Wetten | Meta | — | — |
| Recap | Post-Trip | — | — |

---

## Rollout

### Phase 1 — MVP (Belek)
```
✅ Auth (Invite-Link)
✅ Teilnehmer-Formular (konfigurierbar)
✅ Packages
✅ Flug
✅ Extras (Golf-Tage)
✅ Golf-Modul + Golfplatz-Import
✅ Chat
✅ Fotos
✅ Event Master Dashboard
```

### Phase 2
```
○ Wetten
○ Zimmer-Zuteilung
○ Checkliste
○ Reminder-System
○ Recap
○ Poker
```

### Phase 3
```
○ Ski
○ Darts / Bowling / Padel
○ Tipp-Spiel / Kochen
○ B2B / Agency-Modus
```
