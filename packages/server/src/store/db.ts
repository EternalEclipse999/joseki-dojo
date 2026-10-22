import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MIGRATIONS, type Migration } from './migrations'

export type Db = Database.Database
export type Statement = Database.Statement

/**
 * A repository's statements, each prepared on its first use and kept: preparing costs more than running a small
 * statement, and a level replay runs a few of them for every card.
 */
export function statements(db: Db): (sql: string) => Statement {
  const prepared = new Map<string, Statement>()
  return (sql) => {
    let statement = prepared.get(sql)
    if (!statement) {
      statement = db.prepare(sql)
      prepared.set(sql, statement)
    }
    return statement
  }
}

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

/** Applies the migrations not yet recorded in `schema_migrations`; returns the versions applied. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const applied = new Set(rows.map((r) => r.version))
  const ran: number[] = []
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString())
    })()
    ran.push(m.version)
  }
  return ran
}
