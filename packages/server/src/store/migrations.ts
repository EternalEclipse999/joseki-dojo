/**
 * Schema migrations in order, applied by `migrate`. They live in code rather than in .sql files so that the bundled
 * desktop app needs no files next to its JavaScript. Never edit a shipped migration: add the next one.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '001_init.sql',
    sql: `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  mode TEXT NOT NULL,
  environment TEXT NOT NULL,
  user_color TEXT NOT NULL CHECK (user_color IN ('B', 'W')),
  bot_rank TEXT NOT NULL,
  corner TEXT NOT NULL CHECK (corner IN ('TL', 'TR', 'BL', 'BR')),
  status TEXT NOT NULL CHECK (status IN ('playing', 'finished', 'abandoned')),
  parent_session_id TEXT REFERENCES sessions (id),
  initial_moves_json TEXT NOT NULL DEFAULT '[]',
  summary_json TEXT
);

CREATE TABLE moves (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('B', 'W')),
  move TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'bot', 'auto-tenuki')),
  in_zone INTEGER NOT NULL,
  PRIMARY KEY (session_id, turn)
);

CREATE TABLE analyses (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('position', 'pass_probe')),
  visits INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, turn, kind)
);

CREATE TABLE missed_punishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  turn INTEGER NOT NULL,
  bot_move TEXT NOT NULL,
  bot_loss REAL NOT NULL,
  user_move TEXT NOT NULL,
  user_loss REAL NOT NULL,
  best_move TEXT NOT NULL,
  best_pv_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX missed_punishments_session ON missed_punishments (session_id);
`,
  },
  {
    version: 2,
    name: '002_traps.sql',
    sql: `
ALTER TABLE sessions ADD COLUMN trap_json TEXT;

CREATE TABLE trap_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  trap_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('correct', 'caught', 'other')),
  created_at TEXT NOT NULL
);

CREATE INDEX trap_attempts_trap ON trap_attempts (trap_id);
`,
  },
  {
    version: 3,
    name: '003_starts.sql',
    sql: `
ALTER TABLE sessions ADD COLUMN start_json TEXT;
`,
  },
  {
    version: 4,
    name: '004_cards.sql',
    sql: `
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('position', 'move')),
  card_key TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL,
  fsrs_json TEXT NOT NULL,
  due TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cards_due ON cards (deleted, due);

CREATE TABLE card_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  reviewed_at TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  auto_rating TEXT NOT NULL CHECK (auto_rating IN ('again', 'hard', 'good', 'easy')),
  worst_json TEXT,
  state_before_json TEXT NOT NULL,
  session_id TEXT
);
CREATE INDEX card_reviews_card ON card_reviews (card_id, id);
CREATE UNIQUE INDEX card_reviews_session ON card_reviews (card_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX card_reviews_session_only ON card_reviews (session_id);
`,
  },
  {
    version: 5,
    name: '005_app_state.sql',
    sql: `
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`,
  },
  {
    version: 6,
    name: '006_graph_cards.sql',
    sql: `
CREATE TABLE graph_cards (
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'rest')),
  color TEXT NOT NULL CHECK (color IN ('B', 'W')),
  fsrs_json TEXT NOT NULL,
  due TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, kind, color)
);

CREATE TABLE graph_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  manual TEXT CHECK (manual IN ('again', 'hard', 'good', 'easy')),
  auto TEXT NOT NULL CHECK (auto IN ('again', 'hard', 'good', 'easy')),
  raw_json TEXT NOT NULL,
  FOREIGN KEY (card_key, kind, color) REFERENCES graph_cards (key, kind, color) ON DELETE CASCADE
);
CREATE INDEX graph_reviews_card ON graph_reviews (card_key, kind, color, id);
CREATE UNIQUE INDEX graph_reviews_session ON graph_reviews (card_key, kind, color, session_id);

CREATE TABLE graph_seen (
  key TEXT PRIMARY KEY,
  first_at TEXT NOT NULL
);
`,
  },
  {
    version: 7,
    name: '007_card_raw.sql',
    sql: `
ALTER TABLE card_reviews ADD COLUMN raw_json TEXT;
ALTER TABLE card_reviews ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
UPDATE card_reviews SET manual = 1 WHERE rating <> auto_rating;
`,
  },
]
