import type { Move, ReviewData } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../store/records'
import { cornerGroup, findProblems, problemKey, zoneStones } from './problem'

const mv = (color: 'B' | 'W', x: number, y: number): Move => ({ color, vertex: [x, y] })
// Q16 (the 4-4 point) and O17 in the top-right corner, and the same stones in the bottom-left corner.
const tr: Move[] = [mv('B', 15, 3), mv('W', 13, 2)]
const bl: Move[] = [mv('B', 3, 15), mv('W', 5, 16)]
// The top-right stones mirrored in the corner's diagonal: R16 ↔ Q17 means [16,3] ↔ [15,2]; [13,2] ↔ [16,5].
const trMirrored: Move[] = [mv('B', 15, 3), mv('W', 16, 5)]

describe('problem keys', () => {
  it('is the same for the same position in another corner or mirrored, and differs by the colour to move', () => {
    expect(problemKey(bl, 'BL', 'B')).toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(trMirrored, 'TR', 'B')).toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(tr, 'TR', 'W')).not.toBe(problemKey(tr, 'TR', 'B'))
    expect(problemKey(tr, 'TR', 'B')).toMatch(/^move:B:/)
  })

  it('names the group by the first stone in the corner', () => {
    expect(cornerGroup(tr, 'TR')).toBe('4-4')
    expect(cornerGroup([mv('B', 16, 3)], 'TR')).toBe('3-4')
    expect(cornerGroup([mv('B', 3, 2)], 'TL')).toBe('3-4')
    expect(cornerGroup([mv('B', 16, 2)], 'TR')).toBe('3-3')
    expect(cornerGroup([mv('B', 15, 4)], 'TR')).toBe('5-4')
    expect(cornerGroup([mv('B', 16, 4)], 'TR')).toBe('5-3')
    expect(cornerGroup([mv('B', 12, 6)], 'TR')).toBeNull()
  })

  it('lists the zone stones seen in the top-right corner', () => {
    expect(zoneStones(bl, 'BL')).toEqual({ black: ['Q16'], white: ['O17'] })
  })

  it('leaves captured stones out of the zone', () => {
    // White T19 is captured by Black S19 and T18; the white tenuki at D16 is outside the zone.
    const captured: Move[] = [mv('W', 18, 0), mv('B', 17, 0), mv('W', 3, 3), mv('B', 18, 1)]
    expect(zoneStones(captured, 'TR')).toEqual({ black: ['S19', 'T18'], white: [] })
  })
})

/** A training of user (Black) moves with the given losses; positions carry one candidate each. */
function training(user: { x: number; y: number; loss: number; category: 'exact' | 'inaccuracy' | 'mistake' | 'blunder' }[]): [SessionRecord, ReviewData] {
  const moves = user.flatMap((u, i) => [
    { color: 'B' as const, vertex: [u.x, u.y] as [number, number], actor: 'user' as const, inZone: true },
    { color: 'W' as const, vertex: [8 + i, 9] as [number, number], actor: 'bot' as const, inZone: true },
  ])
  const settings = { mode: 'free' as const, environment: 'empty' as const, userColor: 'B' as const, botRank: '5k', corner: 'TR' as const }
  const rec = { id: 's1', createdAt: '', finishedAt: '', settings, status: 'finished', parentSessionId: null, initialMoves: [], moves, summary: null } as unknown as SessionRecord
  const review = {
    sessionId: 's1', settings, initialMoves: [], moves,
    positions: Array.from({ length: moves.length + 1 }, (_, turn) => ({ turn, scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: [15, 3], loss: 0, pv: [[15, 3]] }], ownership: null })),
    moveReviews: moves.map((m, turn) => ({ turn, color: m.color, actor: m.actor, vertex: m.vertex, loss: m.actor === 'user' ? user[turn / 2].loss : 0, category: m.actor === 'user' ? user[turn / 2].category : 'exact' })),
    punishments: [], summary: { userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 },
  } as unknown as ReviewData
  return [rec, review]
}

describe('findProblems', () => {
  it('takes the user mistakes and blunders in the zone, with the position before the move', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 2.4, category: 'mistake' },
    ])
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ source: 'mistake', userMove: [13, 2], userLoss: 2.4, moveNumber: 3, toMove: 'B' })
    expect(found[0].moves).toHaveLength(2)
    expect(found[0].analysis.candidates[0]).toEqual({ vertex: [15, 3], loss: 0, pv: [[15, 3]] })
  })

  it('skips a position whose analysis has no candidates', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 2.4, category: 'mistake' },
    ])
    review.positions[2].candidates = []
    expect(findProblems(rec, review)).toEqual([])
  })

  it('takes an unpunished in-zone bot mistake as the position before the reply, once per position', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 3, category: 'mistake' },
    ])
    review.punishments = [{ turn: 1, botLoss: 3, userLoss: 3, punished: false, kept: 0 }]
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0].source).toBe('unpunished')
  })
  it('takes no problem from a mistake or an unpunished bot mistake outside the zone', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 2.4, category: 'mistake' },
    ])
    review.moves[2].inZone = false
    expect(findProblems(rec, review)).toEqual([])
    review.moves[2].inZone = true
    review.moves[1].inZone = false
    review.punishments = [{ turn: 1, botLoss: 3, userLoss: 0, punished: false, kept: 0 }]
    review.moveReviews[2].category = 'exact'
    expect(findProblems(rec, review)).toEqual([])
  })

  it('takes a blunder in the zone as a mistake problem', () => {
    const [rec, review] = training([{ x: 15, y: 3, loss: 9, category: 'blunder' }])
    expect(findProblems(rec, review)).toEqual([expect.objectContaining({ source: 'mistake', userLoss: 9, moveNumber: 1, moves: [] })])
  })

  it('takes nothing from a punished bot mistake', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 0, category: 'exact' },
    ])
    review.punishments = [{ turn: 1, botLoss: 3, userLoss: 0, punished: true, kept: 3 }]
    expect(findProblems(rec, review)).toEqual([])
  })

  it('makes the position before the user reply of an unpunished bot mistake, with the reply as the user move', () => {
    const [rec, review] = training([
      { x: 15, y: 3, loss: 0, category: 'exact' },
      { x: 13, y: 2, loss: 0, category: 'exact' },
    ])
    review.punishments = [{ turn: 1, botLoss: 3, userLoss: 0, punished: false, kept: 0 }]
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      source: 'unpunished', toMove: 'B', userMove: [13, 2], moveNumber: 3,
      moves: [mv('B', 15, 3), mv('W', 8, 9)],
    })
  })

  it('shifts the move number by the setup moves and prefixes them to the moves', () => {
    const [rec, review] = training([{ x: 15, y: 3, loss: 0, category: 'exact' }, { x: 13, y: 2, loss: 2.4, category: 'mistake' }])
    const setupMoves = [mv('B', 16, 3), mv('W', 3, 3)]
    ;(rec as { initialMoves: Move[] }).initialMoves = setupMoves
    const found = findProblems(rec, review)
    expect(found).toHaveLength(1)
    expect(found[0].moveNumber).toBe(5)
    expect(found[0].moves).toEqual([...setupMoves, mv('B', 15, 3), mv('W', 8, 9)])
  })
})
