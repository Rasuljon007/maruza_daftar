CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL UNIQUE,
  first_name    TEXT,
  username      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  confirmed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lectures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT 'Nomsiz ma''ruza',
  subject        TEXT,
  source         TEXT NOT NULL CHECK (source IN ('recording', 'upload')),
  status         TEXT NOT NULL DEFAULT 'recording'
                 CHECK (status IN ('recording', 'queued', 'transcribing', 'analyzing', 'ready', 'failed')),
  progress       INTEGER NOT NULL DEFAULT 0,
  progress_label TEXT,
  error_message  TEXT,
  error_stage    TEXT,
  duration_sec   NUMERIC,
  original_ext   TEXT,
  student_notes  TEXT NOT NULL DEFAULT '',
  slide_count    INTEGER NOT NULL DEFAULT 10 CHECK (slide_count BETWEEN 5 AND 20),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lectures_user_idx ON lectures (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audio_chunks (
  lecture_id   UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  bytes        INTEGER NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecture_id, seq)
);

CREATE TABLE IF NOT EXISTS marks (
  id          SERIAL PRIMARY KEY,
  lecture_id  UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  t_sec       NUMERIC NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marks_lecture_idx ON marks (lecture_id, t_sec);

CREATE TABLE IF NOT EXISTS photos (
  id          SERIAL PRIMARY KEY,
  lecture_id  UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  t_sec       NUMERIC NOT NULL,
  mime        TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_lecture_idx ON photos (lecture_id, t_sec);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id          SERIAL PRIMARY KEY,
  lecture_id  UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  start_sec   NUMERIC NOT NULL,
  end_sec     NUMERIC NOT NULL,
  text        TEXT NOT NULL,
  edited      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (lecture_id, idx)
);

CREATE TABLE IF NOT EXISTS analyses (
  lecture_id  UUID PRIMARY KEY REFERENCES lectures(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  data        JSONB NOT NULL,
  has_pptx    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
