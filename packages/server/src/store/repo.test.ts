import type { Vertex } from '@joseki-dojo/shared'
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
    const next = { version: 2, name: '002_extra.sql', sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY)' }
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([2])
    expect(migrate(db, [...MIGRATIONS, next])).toEqual([])
    expect(db.prepare('SELECT name FROM schema_migrations ORDER BY version').all()).toEqual([{ name: '001_init.sql' }, { name: '002_extra.sql' }])
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
    expect(repo.getAnalysis('s1', 0, 'pass_probe')).toBeNull()
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
