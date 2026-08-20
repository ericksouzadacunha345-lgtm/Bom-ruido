CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','student')),
  school_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  name TEXT NOT NULL,
  online BOOLEAN NOT NULL DEFAULT FALSE,
  manual_offline BOOLEAN NOT NULL DEFAULT FALSE,
  current_db DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_reading_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sensors (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  identifier TEXT NOT NULL,
  type TEXT,
  device_id TEXT,
  online BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  sensor_id TEXT REFERENCES sensors(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  sensor TEXT NOT NULL,
  room TEXT NOT NULL,
  db DOUBLE PRECISION NOT NULL,
  dbfs DOUBLE PRECISION,
  status TEXT NOT NULL CHECK (status IN ('Silencioso','Moderado','Crítico')),
  timestamp TIMESTAMPTZ NOT NULL,
  simulated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_readings_school_time ON readings(school_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  school_id TEXT NOT NULL,
  reading_id TEXT REFERENCES readings(id) ON DELETE CASCADE,
  sensor_id TEXT REFERENCES sensors(id) ON DELETE SET NULL,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('moderado','critico','tea')),
  db DOUBLE PRECISION NOT NULL,
  message TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_school_time ON alerts(school_id, timestamp DESC);
CREATE TABLE IF NOT EXISTS configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_configs (school_id TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());


CREATE TABLE IF NOT EXISTS challenge_configs (
  school_id TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
