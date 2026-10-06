import { describe, expect, it } from 'vitest'
import type { Actor, Color, PlayedMove, Vertex } from '@joseki-dojo/shared'
import type { StoredAnalysis } from '../store/records'
import { buildReview, candidatesOf, categorize, findPunishments, missedPunishmentRows, moveLosses, summarize } from './compute'

const th = { inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 1 }
const m = (color: Color, actor: Actor, vertex: Vertex = [0, 0]): PlayedMove => ({ color, actor, vertex, inZone: true })

const analysis = (currentPlayer: Color, scoreLead: number, best = 'D4'): StoredAnalysis => ({
  rootInfo: { currentPlayer, scoreLead, winrate: 0.5, visits: 10 },
  moveInfos: [{ move: best, order: 0, visits: 10, scoreLead, winrate: 0.5, pv: [best] }],
  ownership: null,
})

describe('categorize', () => {
  it('uses the thresholds as lower bounds', () => {
    expect(categorize(0.49, th)).toBe('exact')
    expect(categorize(0.5, th)).toBe('inaccuracy')
    expect(categorize(1.99, th)).toBe('inaccuracy')
    expect(categorize(2, th)).toBe('mistake')
    expect(categorize(5, th)).toBe('blunder')
  })
})

describe('moveLosses', () => {
  it("measures each move from the mover's side and clips noise at zero", () => {
    expect(moveLosses([3, 1, 4, 4.3], [m('B', 'user'), m('W', 'bot'), m('B', 'user')])).toEqual([2, 3, 0])
  })
})

describe('candidatesOf', () => {
  it('sorts by order and measures losses for the side to move', () => {
    const a: StoredAnalysis = {
      rootInfo: { currentPlayer: 'W', scoreLead: -2, winrate: 0.4, visits: 10 },
      moveInfos: [
        { move: 'R14', order: 1, visits: 3, scoreLead: -1, winrate: 0.45, pv: ['R14'] },
        { move: 'Q14', order: 0, visits: 6, scoreLead: -2, winrate: 0.4, pv: ['Q14', 'R14'] },
        { move: 'pass', order: 2, visits: 1, scoreLead: 3, winrate: 0.7, pv: [] },
        { move: 'D4', order: 3, visits: 1, scoreLead: 0, winrate: 0.5, pv: [] },
      ],
      ownership: null,
    }
    expect(candidatesOf(a)).toEqual([
      { vertex: [15, 5], loss: 0, pv: [[15, 5], [16, 5]] },
      { vertex: [16, 5], loss: 1, pv: [[16, 5]] },
      { vertex: 'pass', loss: 5, pv: [] },
    ])
  })
})

describe('punishments', () => {
  const moves = [m('B', 'user'), m('W', 'bot'), m('B', 'user'), m('W', 'bot'), m('B', 'auto-tenuki'), m('W', 'bot')]
  const losses = [0, 3, 0.4, 6, 4, 2.5]

  it('scores the user reply to every bot mistake that has one', () => {
    const events = findPunishments(moves, losses, 'B', th)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ turn: 1, botLoss: 3, userLoss: 0.4, punished: true })
    expect(events[0].kept).toBeCloseTo(2.6)
    expect(events[1]).toEqual({ turn: 3, botLoss: 6, userLoss: 4, punished: false, kept: 2 })
  })

  it('ignores bot inaccuracies', () => {
    expect(findPunishments([m('W', 'bot'), m('B', 'user')], [1.5, 0], 'B', th)).toEqual([])
  })

  it('summarizes the session', () => {
    const events = findPunishments(moves, losses, 'B', th)
    const s = summarize(moves, losses, events, 'B')
    expect(s.userLoss).toBeCloseTo(4.4)
    expect(s.botMistakes).toBe(2)
    expect(s.botMistakeLoss).toBe(9)
    expect(s.punished).toBe(1)
    expect(s.keptPoints).toBeCloseTo(4.6)
  })
})

describe('buildReview', () => {
  const moves = [m('B', 'user', [15, 3]), m('W', 'bot', [16, 5]), m('B', 'user', [14, 5])]
  const analyses = [analysis('B', 0, 'D4'), analysis('W', 0, 'Q4'), analysis('B', 3, 'D16'), analysis('W', 2, 'C3')]
  const input = {
    sessionId: 's1',
    settings: { mode: 'free' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '7k', corner: 'TR' as const },
    initialMoves: [],
    moves,
    analyses,
    thresholds: th,
  }

  it('requires one analysis per position', () => {
    expect(() => buildReview({ ...input, analyses: analyses.slice(1) })).toThrow(/Expected 4 analyses/)
  })

  it('assembles losses, categories, punishments and the summary', () => {
    const r = buildReview(input)
    expect(r.moveReviews.map((x) => x.category)).toEqual(['exact', 'mistake', 'inaccuracy'])
    expect(r.punishments).toEqual([{ turn: 1, botLoss: 3, userLoss: 1, punished: false, kept: 2 }])
    expect(r.summary).toEqual({ userLoss: 1, botMistakes: 1, botMistakeLoss: 3, punished: 0, keptPoints: 2 })
    expect(r.positions).toHaveLength(4)
    expect(r.positions[0].candidates[0].vertex).toEqual([3, 15])
  })

  it('lists missed punishments with the best reply', () => {
    expect(missedPunishmentRows(buildReview(input))).toEqual([
      { turn: 1, botMove: [16, 5], botLoss: 3, userMove: [14, 5], userLoss: 1, bestMove: [3, 3], bestPv: [[3, 3]] },
    ])
  })
})
