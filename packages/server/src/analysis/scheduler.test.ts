import { describe, expect, it } from 'vitest'
import { StubEngine } from '../../test/helpers'
import type { AnalysisResponse } from '../engine/katago-types'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { SessionRepo } from '../store/repo'
import { compactAnalysis } from './compact'
import { AnalysisScheduler } from './scheduler'

function setup(visits = { reviewVisits: 10, endVisits: 5 }) {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const rec: SessionRecord = {
    id: 's1',
    createdAt: '2026-10-06T10:00:00.000Z',
    finishedAt: null,
    settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    status: 'playing',
    parentSessionId: null,
    initialMoves: [{ color: 'B', vertex: [15, 3] }],
    moves: [{ color: 'W', vertex: [16, 5], actor: 'bot', inZone: true }],
    summary: null,
  }
  repo.insertSession(rec)
  return { engine, repo, rec, scheduler: new AnalysisScheduler(engine, repo, visits) }
}

describe('AnalysisScheduler', () => {
  it('analyses a position with ownership and stores it', async () => {
    const { engine, repo, rec, scheduler } = setup()
    engine.lead = () => 2.5
    const a = await scheduler.position(rec, 1)
    expect(engine.queries[0]).toMatchObject({ moves: [['B', 'Q16'], ['W', 'R14']], maxVisits: 10, includeOwnership: true })
    expect(a.rootInfo.scoreLead).toBe(2.5)
    expect(repo.getAnalysis('s1', 1, 'position')?.visits).toBe(10)
  })

  it('reuses stored results and shares concurrent requests', async () => {
    const { engine, rec, scheduler } = setup()
    await Promise.all([scheduler.position(rec, 0), scheduler.position(rec, 0)])
    await scheduler.position(rec, 0)
    expect(engine.queries).toHaveLength(1)
  })

  it('re-analyses when the stored result has fewer visits than required', async () => {
    const { engine, repo, rec } = setup()
    await new AnalysisScheduler(engine, repo, { reviewVisits: 10, endVisits: 5 }).position(rec, 0)
    await new AnalysisScheduler(engine, repo, { reviewVisits: 50, endVisits: 5 }).position(rec, 0)
    expect(engine.queries.map((q) => q.maxVisits)).toEqual([10, 50])
  })
})

describe('compactAnalysis', () => {
  it('keeps the five best move infos in order', () => {
    const r: AnalysisResponse = {
      id: 'x',
      turnNumber: 0,
      isDuringSearch: false,
      rootInfo: { currentPlayer: 'B', scoreLead: 1, winrate: 0.6, visits: 100 },
      moveInfos: [6, 2, 0, 5, 1, 4, 3].map((order) => ({ move: 'D4', order, visits: 10, scoreLead: order, winrate: 0.5, pv: ['D4'], prior: 0.1 })),
      ownership: [0.5],
    }
    const a = compactAnalysis(r)
    expect(a.moveInfos.map((m) => m.order)).toEqual([0, 1, 2, 3, 4])
    expect(a.moveInfos[0]).toEqual({ move: 'D4', order: 0, visits: 10, scoreLead: 0, winrate: 0.5, pv: ['D4'] })
    expect(a.rootInfo).toEqual({ currentPlayer: 'B', scoreLead: 1, winrate: 0.6, visits: 100 })
    expect(a.ownership).toEqual([0.5])
  })
})
