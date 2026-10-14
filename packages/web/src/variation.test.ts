import { describe, expect, it } from 'vitest'
import type { Move, PositionReview, Vertex } from '@joseki-dojo/shared'
import {
  isLegalNext,
  mergeResult,
  moveLoss,
  playInVariation,
  positionKey,
  bestIsPass,
  candidateIndex,
  candidateLeft,
  replyVertex,
  shouldReply,
  shownMoves,
  startVariation,
  stepVariation,
  variationMoves,
  type VariationResult,
  type VariationUpdate,
} from './variation'

const R6: Vertex = [16, 13]
const D4: Vertex = [3, 15]
const C17: Vertex = [2, 2]
const Q16: Vertex = [15, 3]

const review = (turn: number, best: PositionReview['candidates'][number]['vertex'] = D4, lead = 0): PositionReview => ({
  turn,
  scoreLeadBlack: lead,
  visits: 10,
  candidates: [{ vertex: best, loss: 0, pv: [best] }],
  ownership: null,
})

const update = (moves: Vertex[], visits: number, done = false, lead = 0): VariationUpdate => ({
  type: 'variationAnalysis',
  sessionId: 's',
  fromTurn: 0,
  moves,
  visits,
  done,
  position: review(moves.length, D4, lead),
})

describe('a variation', () => {
  it('starts with one shown move', () => {
    expect(startVariation(2, R6)).toEqual({ fromTurn: 2, moves: [R6], step: 1 })
  })

  it('grows at the end', () => {
    const v = playInVariation(startVariation(0, R6), D4)
    expect(v).toEqual({ fromTurn: 0, moves: [R6, D4], step: 2 })
  })

  it('replaces the hidden tail when played after a step back', () => {
    const v = stepVariation(playInVariation(playInVariation(startVariation(0, R6), D4), Q16), -2)
    expect(v.step).toBe(1)
    expect(playInVariation(v, C17)).toEqual({ fromTurn: 0, moves: [R6, C17], step: 2 })
  })

  it('steps between its first and its last move', () => {
    const v = playInVariation(startVariation(0, R6), D4)
    expect(stepVariation(v, -5).step).toBe(1)
    expect(stepVariation(v, 5).step).toBe(2)
    expect(stepVariation(stepVariation(v, -1), 1).step).toBe(2)
  })

  it('shows the moves up to its step', () => {
    const v = stepVariation(playInVariation(startVariation(0, R6), D4), -1)
    expect(shownMoves(v)).toEqual([R6])
    expect(v.moves).toEqual([R6, D4])
  })
})

describe('variation positions', () => {
  it('are keyed by the replaced move and the variation moves', () => {
    expect(positionKey(3, [])).toBe('3:')
    expect(positionKey(0, [R6, D4])).toBe('0:R6 D4')
  })

  it('alternate colours from the side to move', () => {
    const before: Move[] = [{ color: 'B', vertex: Q16 }]
    expect(variationMoves(before, [R6, D4])).toEqual([
      { color: 'B', vertex: Q16 },
      { color: 'W', vertex: R6 },
      { color: 'B', vertex: D4 },
    ])
    expect(variationMoves([], [R6])).toEqual([{ color: 'B', vertex: R6 }])
    expect(before).toHaveLength(1)
  })

  it('refuse an occupied point', () => {
    const moves: Move[] = [{ color: 'B', vertex: Q16 }]
    expect(isLegalNext(moves, Q16)).toBe(false)
    expect(isLegalNext(moves, R6)).toBe(true)
  })

  it('refuse a move after an illegal history', () => {
    expect(isLegalNext([{ color: 'B', vertex: Q16 }, { color: 'W', vertex: Q16 }], R6)).toBe(false)
  })
})

describe('variation results', () => {
  it('store the first message of a position under its key', () => {
    const r = mergeResult(new Map(), update([R6], 25))
    expect(r.get('0:R6')).toMatchObject({ visits: 25, done: false })
  })

  it('are replaced only by a message with more visits', () => {
    const first = mergeResult(new Map(), update([R6], 50, false, 1))
    expect(mergeResult(first, update([R6], 25, false, 2))).toBe(first)
    expect(mergeResult(first, update([R6], 50, false, 2))).toBe(first)
    const better = mergeResult(first, update([R6], 75, false, 3))
    expect(better.get('0:R6')).toMatchObject({ visits: 75, position: { scoreLeadBlack: 3 } })
    expect(first.get('0:R6')?.visits).toBe(50)
  })

  it('are marked done by a finished search without losing their visits', () => {
    const first = mergeResult(new Map(), update([R6], 100, false, 1))
    const done = mergeResult(first, update([R6], 75, true, 2))
    expect(done.get('0:R6')).toMatchObject({ visits: 100, done: true, position: { scoreLeadBlack: 1 } })
    expect(mergeResult(done, update([R6], 100, true))).toBe(done)
  })

  it('keep other positions apart', () => {
    const r = mergeResult(mergeResult(new Map(), update([R6], 25)), update([R6, D4], 25))
    expect([...r.keys()]).toEqual(['0:R6', '0:R6 D4'])
  })
})

describe('KataGo reply', () => {
  const result = (best: PositionReview['candidates'][number]['vertex']): VariationResult => ({ visits: 10, done: true, position: review(1, best) })

  it('is the best candidate', () => {
    expect(replyVertex(result(D4))).toEqual(D4)
  })

  it('is none without a result, without candidates or for a pass', () => {
    expect(replyVertex(undefined)).toBeNull()
    expect(replyVertex(result('pass'))).toBeNull()
    expect(replyVertex({ visits: 1, done: false, position: { ...review(1), candidates: [] } })).toBeNull()
  })
})

describe('when KataGo replies', () => {
  const at = (visits: number, done = false): VariationResult => ({ visits, done, position: review(1) })

  it('replies at the review visits, or when the search is done', () => {
    expect(shouldReply(undefined, 10)).toBe(false)
    expect(shouldReply(at(9), 10)).toBe(false)
    expect(shouldReply(at(10), 10)).toBe(true)
    expect(shouldReply(at(25), 10)).toBe(true)
    expect(shouldReply(at(5, true), 10)).toBe(true)
  })

  it('waits for the end of the search when the review visits are unknown', () => {
    expect(shouldReply(at(1000), null)).toBe(false)
    expect(shouldReply(at(1000, true), null)).toBe(true)
  })

  it('knows that the best move is a pass', () => {
    expect(bestIsPass({ visits: 1, done: false, position: review(1, 'pass') })).toBe(true)
    expect(bestIsPass(at(1))).toBe(false)
    expect(bestIsPass(undefined)).toBe(false)
  })
})

describe('the chosen candidate', () => {
  const list = [D4, Q16, C17].map((vertex) => ({ vertex }))

  it('is found by its vertex, however the list is ordered', () => {
    expect(candidateIndex(list, Q16)).toBe(1)
    expect(candidateIndex([...list].reverse(), Q16)).toBe(1)
    expect(candidateIndex([list[1], list[0]], D4)).toBe(1)
  })

  it('is the best one when nothing is chosen or the choice has left the list', () => {
    expect(candidateIndex(list, null)).toBe(0)
    expect(candidateIndex(list, R6)).toBe(0)
    expect(candidateLeft(list, null)).toBe(false)
    expect(candidateLeft(list, Q16)).toBe(false)
    expect(candidateLeft(list, R6)).toBe(true)
  })
})

describe('the loss of a variation move', () => {
  it('is measured from the mover', () => {
    expect(moveLoss('B', 2, 1.1)).toBeCloseTo(0.9)
    expect(moveLoss('W', 1, 2.5)).toBeCloseTo(1.5)
  })

  it('is never negative', () => {
    expect(moveLoss('B', 1, 3)).toBe(0)
    expect(moveLoss('W', 3, 1)).toBe(0)
  })
})
