import type { Vertex } from '@joseki-dojo/shared'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, openDb } from './db'
import { MIGRATIONS } from './migrations'
import { movesBefore, type MissedPunishmentRow, type SessionRecord, type StoredAnalysis } from './records'
import { SessionRepo } from './repo'

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-10-06T10:00:00.000Z',
  finishedAt: null,
  settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
  ...over,
})

const analysis = (lead: number): StoredAnalysis => ({
  rootInfo: { currentPlayer: 'B', scoreLead: lead, winrate: 0.5, visits: 10 },
  moveInfos: [{ move: 'D4', order: 0, visits: 10, scoreLead: lead, winrate: 0.5, pv: ['D4', 'Q16'] }],
  ownership: null,
})

describe('migrations', () => {
  it('applies once', () => {
    const db = openDb(':memory:')
    expect(migrate(db)).toEqual([])
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['sessions', 'moves', 'analyses', 'missed_punishments', 'schema_migrations']),
    )
  })

  it('applies only the migrations not recorded yet', () => {
    const db = openDb(':memory:')
    const next = { version: 3, name: '003_extra.sql', sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY)' }
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([3])
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([])
    expect(db.prepare('SELECT name FROM schema_migrations ORDER BY version').all()).toEqual([{ name: '001_init.sql' }, { name: '002_traps.sql' }, { name: '003_extra.sql' }])
  })
})

describe('SessionRepo', () => {
  it('round-trips a session with moves', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    const r = record({
      initialMoves: [{ color: 'B', vertex: [15, 3] }],
      moves: [
        { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        { color: 'B', vertex: 'pass', actor: 'auto-tenuki', inZone: false },
      ],
    })
    repo.insertSession(r)
    expect(repo.getSession('s1')).toEqual(r)
    expect(repo.getSession('missing')).toBeNull()
  })

  it('appends moves and updates status and summary', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    repo.insertMove('s1', 0, { color: 'B', vertex: [15, 3], actor: 'user', inZone: true })
    repo.setStatus('s1', 'finished', '2026-10-06T10:05:00.000Z')
    const summary = { userLoss: 1, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 }
    repo.saveSummary('s1', summary)
    const r = repo.getSession('s1')!
    expect(r.moves).toEqual([{ color: 'B', vertex: [15, 3], actor: 'user', inZone: true }])
    expect(r.status).toBe('finished')
    expect(r.finishedAt).toBe('2026-10-06T10:05:00.000Z')
    expect(r.summary).toEqual(summary)
  })

  it('rejects moves of an unknown session', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    expect(() => repo.insertMove('nope', 0, { color: 'B', vertex: [0, 0], actor: 'user', inZone: false })).toThrow()
  })

  it('stores and replaces analyses', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    repo.saveAnalysis('s1', 0, 'position', 10, analysis(1))
    repo.saveAnalysis('s1', 0, 'position', 500, analysis(2))
    expect(repo.getAnalysis('s1', 0, 'position')).toEqual({ visits: 500, analysis: analysis(2) })
  })

  it('replaces missed punishments', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record())
    const D4: Vertex = [3, 15]
    const row: MissedPunishmentRow = { turn: 1, botMove: [16, 5], botLoss: 3, userMove: 'pass', userLoss: 2, bestMove: D4, bestPv: [D4, 'pass'] }
    repo.replaceMissedPunishments('s1', [row, { ...row, turn: 3 }], '2026-10-06T10:05:00.000Z')
    repo.replaceMissedPunishments('s1', [row], '2026-10-06T10:06:00.000Z')
    expect(repo.listMissedPunishments('s1')).toEqual([row])
  })
})

describe('movesBefore', () => {
  it('joins initial moves and the first t session moves', () => {
    const r = record({
      initialMoves: [{ color: 'B', vertex: [15, 3] }],
      moves: [
        { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
      ],
    })
    expect(movesBefore(r, 1)).toEqual([
      { color: 'B', vertex: [15, 3] },
      { color: 'W', vertex: [16, 5] },
    ])
    expect(movesBefore(r, 0)).toEqual([{ color: 'B', vertex: [15, 3] }])
  })
})

describe('migration 2 and trap attempts', () => {
  it('upgrades an existing v1 database', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, [MIGRATIONS[0]])
    new SessionRepo(db).insertSession(record())
    expect(migrate(db)).toEqual([2])
    const cols = db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as { name: string }[]
    expect(cols.map((c) => c.name)).toContain('trap_json')
    expect(db.prepare('SELECT id, trap_json FROM sessions').all()).toEqual([{ id: 's1', trap_json: null }])
    expect(() => db.prepare("INSERT INTO trap_attempts (session_id, trap_id, result, created_at) VALUES ('s1', 'a', 'bad', 'x')").run()).toThrow()
  })

  it('counts the shows of each trap and drops attempts with their session', () => {
    const db = openDb(':memory:')
    const repo = new SessionRepo(db)
    repo.insertSession(record({ id: 's1' }))
    repo.insertSession(record({ id: 's2' }))
    expect(repo.trapShows().size).toBe(0)
    const at = '2026-10-12T10:00:00.000Z'
    repo.insertTrapAttempt({ sessionId: 's1', trapId: 'aaaaaaaa', result: 'correct', createdAt: at })
    repo.insertTrapAttempt({ sessionId: 's2', trapId: 'aaaaaaaa', result: 'caught', createdAt: at })
    repo.insertTrapAttempt({ sessionId: 's2', trapId: 'bbbbbbbb', result: 'other', createdAt: at })
    expect(repo.trapShows()).toEqual(new Map([['aaaaaaaa', 2], ['bbbbbbbb', 1]]))
    expect(() => repo.insertTrapAttempt({ sessionId: 'nope', trapId: 'c', result: 'other', createdAt: at })).toThrow()
    db.prepare('DELETE FROM sessions WHERE id = ?').run('s2')
    expect(repo.trapShows()).toEqual(new Map([['aaaaaaaa', 1]]))
  })
})
