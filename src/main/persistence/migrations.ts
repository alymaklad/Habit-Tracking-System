/**
 * Numbered, append-only migrations. Never edit a shipped migration — add a new one.
 *
 * Shape notes that matter elsewhere in the app:
 *  - `occurrence.date` is a LOCAL calendar date (`YYYY-MM-DD`), never an instant.
 *  - `occurrence.google_task_id` is UNIQUE so a replayed sync cannot create a second
 *    row for the same Google task. SQLite permits many NULLs in a UNIQUE column, which
 *    is exactly what unprovisioned occurrences need.
 *  - `daily_record` and `weekly_record` are CACHES of a pure computation. They can be
 *    dropped and rebuilt from `occurrence` + `time_log` at any time.
 */
export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE app_user (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  name          TEXT,
  email         TEXT,
  timezone      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE habit (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT    NOT NULL,
  description             TEXT,
  notes                   TEXT,
  recurrence              TEXT    NOT NULL,          -- JSON Recurrence
  scheduled_time          TEXT    NOT NULL,          -- HH:MM local
  target_minutes          INTEGER NOT NULL,
  baseline_minutes        INTEGER NOT NULL,
  difficulty_level        INTEGER NOT NULL DEFAULT 1,
  reminder_lead_minutes   INTEGER,                   -- NULL inherits the global default
  color_key               TEXT    NOT NULL DEFAULT 'violet',
  google_tasklist_id      TEXT,
  active                  INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT    NOT NULL
);
CREATE INDEX idx_habit_active ON habit (active);

CREATE TABLE occurrence (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id          INTEGER NOT NULL REFERENCES habit (id) ON DELETE CASCADE,
  date              TEXT    NOT NULL,                -- LOCAL YYYY-MM-DD
  scheduled_time    TEXT    NOT NULL,
  target_minutes    INTEGER NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'pending',
  completed_at      TEXT,
  justified_skip    INTEGER NOT NULL DEFAULT 0,
  skip_reason       TEXT,
  google_task_id    TEXT    UNIQUE,
  provision_state   TEXT    NOT NULL DEFAULT 'none',
  created_by_app    INTEGER NOT NULL DEFAULT 0,
  etag              TEXT,
  last_modified     TEXT,
  deleted_at        TEXT,
  reminder_sent_at  TEXT,
  UNIQUE (habit_id, date)
);
CREATE INDEX idx_occurrence_date ON occurrence (date);
CREATE INDEX idx_occurrence_habit_date ON occurrence (habit_id, date);
CREATE INDEX idx_occurrence_provision ON occurrence (provision_state);

CREATE TABLE time_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id       INTEGER NOT NULL REFERENCES habit (id) ON DELETE CASCADE,
  occurrence_id  INTEGER REFERENCES occurrence (id) ON DELETE CASCADE,
  started_at     TEXT    NOT NULL,
  ended_at       TEXT,
  minutes        INTEGER NOT NULL DEFAULT 0,
  origin         TEXT    NOT NULL
);
CREATE INDEX idx_time_log_occurrence ON time_log (occurrence_id);
CREATE INDEX idx_time_log_open ON time_log (ended_at) WHERE ended_at IS NULL;

CREATE TABLE daily_record (
  habit_id          INTEGER NOT NULL REFERENCES habit (id) ON DELETE CASCADE,
  date              TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  points            INTEGER NOT NULL DEFAULT 0,
  xp                INTEGER NOT NULL DEFAULT 0,
  duration_minutes  INTEGER NOT NULL DEFAULT 0,
  target_minutes    INTEGER NOT NULL DEFAULT 0,
  origin            TEXT,
  PRIMARY KEY (habit_id, date)
);
CREATE INDEX idx_daily_record_date ON daily_record (date);

CREATE TABLE weekly_record (
  week_start              TEXT PRIMARY KEY,
  total_points            INTEGER NOT NULL DEFAULT 0,
  completion_rate         REAL    NOT NULL DEFAULT 0,
  total_minutes           INTEGER NOT NULL DEFAULT 0,
  improvement_percentage  REAL,
  xp                      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE difficulty_proposal (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id         INTEGER NOT NULL REFERENCES habit (id) ON DELETE CASCADE,
  week_start       TEXT    NOT NULL,
  current_level    INTEGER NOT NULL,
  proposed_level   INTEGER NOT NULL,
  current_target   INTEGER NOT NULL,
  proposed_target  INTEGER NOT NULL,
  completion_rate  REAL    NOT NULL,
  rationale        TEXT    NOT NULL,
  state            TEXT    NOT NULL DEFAULT 'pending',
  created_at       TEXT    NOT NULL,
  UNIQUE (habit_id, week_start)
);

CREATE TABLE user_achievement (
  achievement_key  TEXT PRIMARY KEY,
  unlocked_at      TEXT NOT NULL
);

CREATE TABLE personal_record (
  kind         TEXT PRIMARY KEY,
  value        REAL NOT NULL,
  display      TEXT NOT NULL,
  achieved_on  TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE sync_state (
  tasklist_id        TEXT PRIMARY KEY,
  updated_watermark  TEXT,
  last_success_at    TEXT,
  last_error         TEXT,
  failures           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  level      TEXT NOT NULL,
  message    TEXT NOT NULL,
  payload    TEXT
);
CREATE INDEX idx_sync_log_at ON sync_log (at DESC);

CREATE TABLE pending_op (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL,      -- create | patch | delete
  occurrence_id INTEGER REFERENCES occurrence (id) ON DELETE CASCADE,
  payload       TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE oauth_token (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  ciphertext   BLOB NOT NULL,
  account      TEXT,
  scope        TEXT,
  updated_at   TEXT NOT NULL
);
`
  },
  {
    id: 2,
    name: 'calendar mirror for mobile reminders',
    sql: `
-- A Google Task carries no time of day, and a date-only task fires no timed
-- notification on mobile. To deliver "German starts in 30 minutes" to a phone, each
-- occurrence is mirrored as a timed event on a secondary calendar the app creates,
-- carrying a popup reminder. Completion still comes only from the Task.
ALTER TABLE occurrence ADD COLUMN google_event_id TEXT;
ALTER TABLE occurrence ADD COLUMN event_etag TEXT;
CREATE UNIQUE INDEX idx_occurrence_event ON occurrence (google_event_id)
  WHERE google_event_id IS NOT NULL;
`
  }
]
