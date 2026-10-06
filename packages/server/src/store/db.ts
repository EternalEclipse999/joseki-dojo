import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Db = Database.Database

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** Applies `NNN_name.sql` files not yet recorded in `schema_migrations`; returns the versions applied. */
export function migrate(db: Db, dir: string = MIGRATIONS_DIR): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(rows.map((r) => r.version))
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
  const ran: number[] = []
  for (const file of files) {
    const version = Number(file.slice(0, 3))
    if (applied.has(version)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, file, new Date().toISOString())
    })()
    ran.push(version)
  }
  return ran
}
