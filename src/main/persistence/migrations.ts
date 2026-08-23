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
  },
  {
    id: 3,
    name: 'to-do list',
    sql: `
-- Two kinds of entry share one table because they share a lifecycle — ordering,
-- completion, carrying forward — and differ only in what they are attached to:
--
--   manual  : a standalone item, owned by a DATE, carried forward if unfinished
--   subtask : a step of one habit occurrence; when every subtask is done the
--             occurrence itself is marked complete
--
-- Subtasks are never carried forward: they belong to a specific day's occurrence,
-- and moving one to tomorrow would silently rewrite what happened yesterday.
CREATE TABLE todo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT    NOT NULL CHECK (kind IN ('manual', 'subtask')),
  title          TEXT    NOT NULL,
  notes          TEXT,

  -- Manual items only: the day the item currently sits on. Carrying forward moves
  -- this while leaving created_on alone, so "carried N days" is derivable.
  date           TEXT,
  created_on     TEXT,

  -- Subtasks only.
  occurrence_id  INTEGER REFERENCES occurrence (id) ON DELETE CASCADE,
  habit_id       INTEGER REFERENCES habit (id) ON DELETE CASCADE,

  position       INTEGER NOT NULL DEFAULT 0,
  done           INTEGER NOT NULL DEFAULT 0,
  completed_at   TEXT,
  -- Set when the user gives up on an item rather than completing it. Kept rather
  -- than deleted so the avoidance detector can still see the history.
  dropped_at     TEXT,
  created_at     TEXT    NOT NULL,

  -- A manual item must sit on a date; a subtask must belong to an occurrence.
  CHECK (
    (kind = 'manual'  AND date IS NOT NULL AND occurrence_id IS NULL) OR
    (kind = 'subtask' AND occurrence_id IS NOT NULL)
  )
);

CREATE INDEX idx_todo_date ON todo (date) WHERE kind = 'manual';
CREATE INDEX idx_todo_occurrence ON todo (occurrence_id) WHERE kind = 'subtask';
CREATE INDEX idx_todo_open ON todo (done, dropped_at);

-- A habit can carry a template of steps, applied to each new occurrence.
CREATE TABLE habit_subtask_template (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  habit_id   INTEGER NOT NULL REFERENCES habit (id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subtask_template_habit ON habit_subtask_template (habit_id);
`
  }
]
