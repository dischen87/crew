CREATE TABLE IF NOT EXISTS "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"logo_url" text,
	"brand_color" text,
	"plan" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_events" (
	"agency_id" uuid,
	"event_id" uuid,
	"client_name" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bet_participants" (
	"bet_id" uuid,
	"member_id" uuid,
	"side" text,
	"accepted" boolean DEFAULT false,
	CONSTRAINT "bet_participants_bet_id_member_id_pk" PRIMARY KEY("bet_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"module_id" uuid,
	"created_by" uuid,
	"type" text,
	"title" text,
	"stake" text,
	"status" text DEFAULT 'open',
	"winner_id" uuid,
	"settled_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bowling_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"date" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bowling_scores" (
	"game_id" uuid,
	"member_id" uuid,
	"frames" jsonb,
	"total" integer,
	CONSTRAINT "bowling_scores_game_id_member_id_pk" PRIMARY KEY("game_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checklist_checks" (
	"item_id" uuid,
	"member_id" uuid,
	"checked" boolean DEFAULT false,
	CONSTRAINT "checklist_checks_item_id_member_id_pk" PRIMARY KEY("item_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"label" text,
	"category" text,
	"required" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cooking_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"category" text,
	"theme" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cooking_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid,
	"member_id" uuid,
	"dish_name" text,
	"photo_url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cooking_ratings" (
	"entry_id" uuid,
	"rater_id" uuid,
	"taste" integer,
	"look" integer,
	"original" integer,
	CONSTRAINT "cooking_ratings_entry_id_rater_id_pk" PRIMARY KEY("entry_id","rater_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_leaderboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"module_id" uuid,
	"member_id" uuid,
	"value" real,
	"label" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "darts_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"mode" text,
	"player1_id" uuid,
	"player2_id" uuid,
	"winner_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "darts_throws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid,
	"player_id" uuid,
	"leg" integer,
	"throw_num" integer,
	"score" integer,
	"remaining" integer,
	"checkout" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0,
	"active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"date_from" date,
	"date_to" date,
	"location" text,
	"cover_image" text,
	"status" text DEFAULT 'planning',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fitness_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"title" text,
	"metric" text,
	"lower_wins" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fitness_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid,
	"member_id" uuid,
	"value" real,
	"video_url" text,
	"verified_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"direction" text,
	"airline" text,
	"flight_number" text,
	"departure_airport" text,
	"arrival_airport" text,
	"departure_time" timestamp with time zone,
	"arrival_time" timestamp with time zone,
	"booking_ref" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_course_holes" (
	"course_id" uuid,
	"hole_number" integer,
	"par" integer,
	"distance_m" integer,
	"handicap_index" integer,
	CONSTRAINT "golf_course_holes_course_id_hole_number_pk" PRIMARY KEY("course_id","hole_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_course_tees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid,
	"name" text NOT NULL,
	"color" text,
	"course_rating" real,
	"slope_rating" integer,
	"length_meters" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"country" text,
	"total_holes" integer DEFAULT 18,
	"par_total" integer,
	"course_rating" real,
	"slope_rating" integer,
	"length_meters" integer,
	"website_url" text,
	"image_url" text,
	"latitude" real,
	"longitude" real,
	"external_id" text,
	"source" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_player_handicaps" (
	"member_id" uuid,
	"event_id" uuid,
	"handicap" real,
	CONSTRAINT "golf_player_handicaps_member_id_event_id_pk" PRIMARY KEY("member_id","event_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"course_id" uuid,
	"tee_id" uuid,
	"format" text DEFAULT 'stableford',
	"game_mode" text DEFAULT 'individual',
	"date" date,
	"tee_time" time
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_scores" (
	"round_id" uuid,
	"member_id" uuid,
	"hole" integer,
	"strokes" integer,
	"putts" integer,
	"net_score" integer,
	"stableford" integer,
	CONSTRAINT "golf_scores_round_id_member_id_hole_pk" PRIMARY KEY("round_id","member_id","hole")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_team_members" (
	"team_id" uuid,
	"member_id" uuid,
	CONSTRAINT "golf_team_members_team_id_member_id_pk" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid,
	"name" text NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golf_tee_hole_distances" (
	"tee_id" uuid,
	"hole_number" integer,
	"distance_m" integer,
	CONSTRAINT "golf_tee_hole_distances_tee_id_hole_number_pk" PRIMARY KEY("tee_id","hole_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"avatar_emoji" text,
	"is_admin" boolean DEFAULT false,
	"joined_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"cover_image" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "groups_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kart_results" (
	"session_id" uuid,
	"member_id" uuid,
	"position" integer,
	"best_lap_ms" integer,
	"total_time_ms" integer,
	"penalties_s" integer DEFAULT 0,
	CONSTRAINT "kart_results_session_id_member_id_pk" PRIMARY KEY("session_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kart_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"session_type" text,
	"track_name" text,
	"laps_total" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"uploader_id" uuid,
	"url" text NOT NULL,
	"thumbnail" text,
	"type" text DEFAULT 'image',
	"likes" integer DEFAULT 0,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid,
	"event_id" uuid,
	"sender_id" uuid,
	"content" text,
	"type" text DEFAULT 'text',
	"media_url" text,
	"link_preview" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "padel_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid,
	"team1_p1" uuid,
	"team1_p2" uuid,
	"team2_p1" uuid,
	"team2_p2" uuid,
	"sets" jsonb,
	"winner_team" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "padel_tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"format" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "participant_extras" (
	"participant_id" uuid,
	"extra_id" uuid,
	"quantity" integer DEFAULT 1,
	"confirmed" boolean DEFAULT false,
	CONSTRAINT "participant_extras_participant_id_extra_id_pk" PRIMARY KEY("participant_id","extra_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "participant_flights" (
	"participant_id" uuid,
	"flight_id" uuid,
	"seat" text,
	"baggage" text,
	CONSTRAINT "participant_flights_participant_id_flight_id_pk" PRIMARY KEY("participant_id","flight_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "participant_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"member_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'pending',
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "participant_packages" (
	"participant_id" uuid,
	"package_id" uuid,
	"confirmed" boolean DEFAULT false,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "participant_packages_participant_id_package_id_pk" PRIMARY KEY("participant_id","package_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poker_players" (
	"tournament_id" uuid,
	"member_id" uuid,
	"current_chips" integer,
	"status" text DEFAULT 'active',
	"position" integer,
	"eliminated_by" uuid,
	"prize_chf" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poker_tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"format" text DEFAULT 'freezeout',
	"buy_in_chf" real,
	"starting_chips" integer DEFAULT 10000,
	"rebuy_allowed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prediction_picks" (
	"prediction_id" uuid,
	"member_id" uuid,
	"option_id" text,
	CONSTRAINT "prediction_picks_prediction_id_member_id_pk" PRIMARY KEY("prediction_id","member_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"title" text,
	"options" jsonb,
	"closes_at" timestamp with time zone,
	"result_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"type" text,
	"message" text,
	"send_at" timestamp with time zone,
	"target" text,
	"sent" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_assignments" (
	"room_id" uuid,
	"participant_id" uuid,
	CONSTRAINT "room_assignments_room_id_participant_id_pk" PRIMARY KEY("room_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"number" text,
	"type" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ski_day_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"member_id" uuid,
	"date" date,
	"resort_id" uuid,
	"km_skied" real,
	"vertical_m" integer,
	"runs_count" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ski_resorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"country" text,
	"region" text,
	"total_km" integer,
	"vertical_m" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"name" text,
	"type" text,
	"date" date,
	"price_chf" real,
	"capacity" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"name" text,
	"description" text,
	"price_chf" real,
	"includes" jsonb,
	"capacity" integer,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_events" ADD CONSTRAINT "agency_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agency_events" ADD CONSTRAINT "agency_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet_participants" ADD CONSTRAINT "bet_participants_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bet_participants" ADD CONSTRAINT "bet_participants_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_module_id_event_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."event_modules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_created_by_group_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_winner_id_group_members_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_settled_by_group_members_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bowling_games" ADD CONSTRAINT "bowling_games_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bowling_scores" ADD CONSTRAINT "bowling_scores_game_id_bowling_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."bowling_games"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bowling_scores" ADD CONSTRAINT "bowling_scores_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checklist_checks" ADD CONSTRAINT "checklist_checks_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checklist_checks" ADD CONSTRAINT "checklist_checks_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cooking_challenges" ADD CONSTRAINT "cooking_challenges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cooking_entries" ADD CONSTRAINT "cooking_entries_challenge_id_cooking_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."cooking_challenges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cooking_entries" ADD CONSTRAINT "cooking_entries_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cooking_ratings" ADD CONSTRAINT "cooking_ratings_entry_id_cooking_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."cooking_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cooking_ratings" ADD CONSTRAINT "cooking_ratings_rater_id_group_members_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_leaderboard" ADD CONSTRAINT "custom_leaderboard_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_leaderboard" ADD CONSTRAINT "custom_leaderboard_module_id_event_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."event_modules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_leaderboard" ADD CONSTRAINT "custom_leaderboard_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_matches" ADD CONSTRAINT "darts_matches_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_matches" ADD CONSTRAINT "darts_matches_player1_id_group_members_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_matches" ADD CONSTRAINT "darts_matches_player2_id_group_members_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_matches" ADD CONSTRAINT "darts_matches_winner_id_group_members_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_throws" ADD CONSTRAINT "darts_throws_match_id_darts_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."darts_matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "darts_throws" ADD CONSTRAINT "darts_throws_player_id_group_members_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_modules" ADD CONSTRAINT "event_modules_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "events" ADD CONSTRAINT "events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fitness_challenges" ADD CONSTRAINT "fitness_challenges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fitness_results" ADD CONSTRAINT "fitness_results_challenge_id_fitness_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."fitness_challenges"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fitness_results" ADD CONSTRAINT "fitness_results_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fitness_results" ADD CONSTRAINT "fitness_results_verified_by_group_members_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "flights" ADD CONSTRAINT "flights_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_course_holes" ADD CONSTRAINT "golf_course_holes_course_id_golf_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."golf_courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_course_tees" ADD CONSTRAINT "golf_course_tees_course_id_golf_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."golf_courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_player_handicaps" ADD CONSTRAINT "golf_player_handicaps_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_player_handicaps" ADD CONSTRAINT "golf_player_handicaps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_rounds" ADD CONSTRAINT "golf_rounds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_rounds" ADD CONSTRAINT "golf_rounds_course_id_golf_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."golf_courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_rounds" ADD CONSTRAINT "golf_rounds_tee_id_golf_course_tees_id_fk" FOREIGN KEY ("tee_id") REFERENCES "public"."golf_course_tees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_scores" ADD CONSTRAINT "golf_scores_round_id_golf_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."golf_rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_scores" ADD CONSTRAINT "golf_scores_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_team_members" ADD CONSTRAINT "golf_team_members_team_id_golf_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."golf_teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_team_members" ADD CONSTRAINT "golf_team_members_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_teams" ADD CONSTRAINT "golf_teams_round_id_golf_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."golf_rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "golf_tee_hole_distances" ADD CONSTRAINT "golf_tee_hole_distances_tee_id_golf_course_tees_id_fk" FOREIGN KEY ("tee_id") REFERENCES "public"."golf_course_tees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kart_results" ADD CONSTRAINT "kart_results_session_id_kart_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."kart_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kart_results" ADD CONSTRAINT "kart_results_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kart_sessions" ADD CONSTRAINT "kart_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media" ADD CONSTRAINT "media_uploader_id_group_members_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_group_members_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_matches" ADD CONSTRAINT "padel_matches_tournament_id_padel_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."padel_tournaments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_matches" ADD CONSTRAINT "padel_matches_team1_p1_group_members_id_fk" FOREIGN KEY ("team1_p1") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_matches" ADD CONSTRAINT "padel_matches_team1_p2_group_members_id_fk" FOREIGN KEY ("team1_p2") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_matches" ADD CONSTRAINT "padel_matches_team2_p1_group_members_id_fk" FOREIGN KEY ("team2_p1") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_matches" ADD CONSTRAINT "padel_matches_team2_p2_group_members_id_fk" FOREIGN KEY ("team2_p2") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "padel_tournaments" ADD CONSTRAINT "padel_tournaments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_extras" ADD CONSTRAINT "participant_extras_participant_id_participant_forms_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_forms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_extras" ADD CONSTRAINT "participant_extras_extra_id_trip_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."trip_extras"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_flights" ADD CONSTRAINT "participant_flights_participant_id_participant_forms_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_forms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_flights" ADD CONSTRAINT "participant_flights_flight_id_flights_id_fk" FOREIGN KEY ("flight_id") REFERENCES "public"."flights"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_forms" ADD CONSTRAINT "participant_forms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_forms" ADD CONSTRAINT "participant_forms_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_packages" ADD CONSTRAINT "participant_packages_participant_id_participant_forms_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_forms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "participant_packages" ADD CONSTRAINT "participant_packages_package_id_trip_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."trip_packages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poker_players" ADD CONSTRAINT "poker_players_tournament_id_poker_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."poker_tournaments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poker_players" ADD CONSTRAINT "poker_players_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poker_players" ADD CONSTRAINT "poker_players_eliminated_by_group_members_id_fk" FOREIGN KEY ("eliminated_by") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "poker_tournaments" ADD CONSTRAINT "poker_tournaments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prediction_picks" ADD CONSTRAINT "prediction_picks_prediction_id_predictions_id_fk" FOREIGN KEY ("prediction_id") REFERENCES "public"."predictions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prediction_picks" ADD CONSTRAINT "prediction_picks_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "predictions" ADD CONSTRAINT "predictions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminders" ADD CONSTRAINT "reminders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "room_assignments" ADD CONSTRAINT "room_assignments_participant_id_participant_forms_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant_forms"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ski_day_logs" ADD CONSTRAINT "ski_day_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ski_day_logs" ADD CONSTRAINT "ski_day_logs_member_id_group_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."group_members"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ski_day_logs" ADD CONSTRAINT "ski_day_logs_resort_id_ski_resorts_id_fk" FOREIGN KEY ("resort_id") REFERENCES "public"."ski_resorts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_extras" ADD CONSTRAINT "trip_extras_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trip_packages" ADD CONSTRAINT "trip_packages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
