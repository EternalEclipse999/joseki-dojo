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
]
