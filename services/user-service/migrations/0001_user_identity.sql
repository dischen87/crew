CREATE TABLE users (
  id TEXT PRIMARY KEY CHECK (id ~ '^usr_[a-f0-9]{32}$'),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  email_verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale <> ''),
  time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (time_zone <> ''),
  reduce_motion BOOLEAN NOT NULL DEFAULT FALSE,
  event_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  product_updates BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_magic_links (
  id TEXT PRIMARY KEY CHECK (id ~ '^ml_[a-f0-9]{32}$'),
  email TEXT NOT NULL CHECK (email = lower(btrim(email))),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_magic_links_email_idx ON user_magic_links (email);

CREATE TABLE user_session_families (
  id TEXT PRIMARY KEY CHECK (id ~ '^ses_[a-f0-9]{32}$'),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, user_id)
);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY CHECK (id ~ '^ses_[a-f0-9]{32}$'),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE CHECK (refresh_token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  replaced_by_session_id TEXT REFERENCES user_sessions(id),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (family_id, user_id)
    REFERENCES user_session_families(id, user_id) ON DELETE CASCADE
);

CREATE INDEX user_sessions_family_idx ON user_sessions (family_id);

CREATE TABLE user_devices (
  id TEXT PRIMARY KEY CHECK (id ~ '^dev_[a-f0-9]{32}$'),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id TEXT NOT NULL CHECK (installation_id <> ''),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  push_token TEXT,
  locale TEXT NOT NULL CHECK (locale <> ''),
  time_zone TEXT NOT NULL CHECK (time_zone <> ''),
  app_version TEXT NOT NULL CHECK (app_version <> ''),
  notifications_enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, installation_id)
);

CREATE INDEX user_devices_user_updated_idx
  ON user_devices (user_id, updated_at DESC, id DESC);

CREATE UNIQUE INDEX user_devices_push_token_unique_idx
  ON user_devices (push_token)
  WHERE push_token IS NOT NULL;
