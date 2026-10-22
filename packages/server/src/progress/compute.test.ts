import type { Color } from '@joseki-dojo/shared'
import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { newState, type FsrsState } from '../cards/schedule'
import { GraphBook } from '../graph/book'
import { lineKey, testGraph } from '../graph/fixture'
import { encodeGraph } from '../graph/format'
import { cardPercent, computeProgress } from './compute'
import { weightedBook, type WeightedEdge } from './fixture'
import type { GraphCardKind } from './repo'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const EARLIER = '2026-10-20T10:00:00.000Z'
const LATER = '2026-10-28T10:00:00.000Z'

/** A reviewed card whose percent is `percent` (its stability is 22^percent − 1 days), due at `due`. */
const card = (percent: number, due = LATER): FsrsState => ({ ...newState(NOW), state: State.Review, reps: 1, stability: 22 ** percent - 1, due })

type Cards = [kind: GraphCardKind, line: string[], state: FsrsState][]

/** computeProgress at 5k with the cards given by the lines of their nodes. */
function progress(book: GraphBook, color: Color, list: Cards = []) {
  const byKey = new Map(list.map(([kind, line, state]) => [`${kind} ${lineKey(line)}`, state]))
  return computeProgress(book, '5k', color, (key, kind) => byKey.get(`${kind} ${key}`) ?? null, NOW)
}

const entry = (percent: number, weight: number, due = false) => ({ percent: expect.closeTo(percent, 6), weight: expect.closeTo(weight, 6), due })

describe('cardPercent', () => {
  it('is 0 without a card and for a new one, else ln(1 + S) / ln 22 of the stability S in days, up to 1', () => {
    const reviewed = (stability: number): FsrsState => ({ ...newState(NOW), state: State.Review, reps: 1, stability })
    expect(cardPercent(null)).toBe(0)
    expect(cardPercent(newState(NOW))).toBe(0)
    expect(cardPercent(reviewed(21))).toBe(1)
    expect(cardPercent(reviewed(2.37))).toBeCloseTo(0.393, 3)
    expect(cardPercent(reviewed(400))).toBe(1)
  })
})

describe('computeProgress', () => {
  it("takes an opponent node's edges as they are, and its rest for the rest card", () => {
    // Q16, then White R14 or R17 (0.4 each) to Black leaves; White's rest is 0.2.
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 1 },
      { line: ['Q16'], move: 'R14', p: 0.4 },
      { line: ['Q16'], move: 'R17', p: 0.4 },
    ]
    const book = weightedBook(edges, { a: ['Q16'] })
    // Under Q16: its rest card (0.2); at each leaf the move card (0.4) and, without good edges, the rest card (0.4).
    const view = progress(book, 'B', [
      ['rest', ['Q16'], card(0.5)],
      ['move', ['Q16', 'R14'], card(1)],
      ['move', ['Q16', 'R17'], card(0.25)],
      ['move', [], card(1)], // the empty corner is not under Q16
    ])
    expect(view).toEqual({ hasWeights: true, level: '5k', color: 'B', overall: { percent: expect.closeTo(1 / 3, 6), due: 0 }, positions: { a: entry((0.2 * 0.5 + 0.4 + 0.4 * 0.25) / 1.8, 1) } })
  })

  it("normalises a player node's good edges, sends the share of a good edge without a node to the rest card and ignores the other edges", () => {
    // At Q16 R14 Black has O16 (ideal, 6/15), R10 (good, 3/15), an unexpanded P17 (ideal, 3/15) and S18 (bad, 2/15); the rest is 1/15.
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 1 },
      { line: ['Q16'], move: 'R14', p: 0.6 },
      { line: ['Q16', 'R14'], move: 'O16', p: 6 / 15 },
      { line: ['Q16', 'R14'], move: 'R10', p: 3 / 15, category: 'good' },
      { line: ['Q16', 'R14'], move: 'P17', p: 3 / 15, expanded: false },
      { line: ['Q16', 'R14'], move: 'S18', p: 2 / 15, category: 'bad' },
    ]
    const book = weightedBook(edges, { a: ['Q16'], p: ['Q16', 'R14'] })
    const cards: Cards = [
      ['move', ['Q16', 'R14'], card(0.5)],
      ['rest', ['Q16', 'R14'], card(1)],
      ['rest', ['Q16', 'R14', 'O16'], card(0.2)],
      ['rest', ['Q16', 'R14', 'S18'], card(1)], // never reached: Black does not play a bad move
    ]
    // Under Q16 R14: the move card (1), the rest card (P17's 0.25), O16's rest (0.5) and R10's rest (0.25) — 2 in all.
    const p = (0.5 + 0.25 * 1 + 0.5 * 0.2) / 2
    // Under Q16 (a list position nested in another, counted on its own): its rest (0.4), then Q16 R14 at 0.6.
    const a = (0.6 * 0.85) / (0.4 + 0.6 * 2)
    const view = progress(book, 'B', cards)
    expect(view.positions).toEqual({ a: entry(a, 1), p: entry(p, 0.6) })
    // The whole list: the positions weighted by the probability of reaching them from the empty corner.
    expect(view.overall).toEqual({ percent: expect.closeTo((1 * a + 0.6 * p) / 1.6, 6), due: 0 })
  })

  it('adds up the probabilities of reaching a position by different move orders', () => {
    // Q16 tenuki R14 and R14 tenuki Q16 are one position.
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 0.4 },
      { line: [], move: 'R14', p: 0.6 },
      { line: ['Q16'], move: 'tenuki', p: 0.4 },
      { line: ['Q16', 'tenuki'], move: 'R14', p: 0.8 },
      { line: ['R14'], move: 'tenuki', p: 0.6 },
      { line: ['R14', 'tenuki'], move: 'Q16', p: 1 },
    ]
    const book = weightedBook(edges, { q: ['Q16'], m: ['Q16', 'tenuki', 'R14'] })
    const view = progress(book, 'B', [
      ['move', ['Q16', 'tenuki'], card(1)],
      ['rest', ['R14', 'tenuki', 'Q16'], card(0.75)],
    ])
    expect(view.positions).toEqual({
      // Its rest (0.6), the move card of Q16 tenuki (0.4) and the rest card after R14 (0.4).
      q: entry((0.4 + 0.4 * 0.75) / 1.4, 0.4),
      m: entry(0.75, 0.4 * 0.4 + 0.6 * 0.6),
    })
  })

  it('sends a back edge to the rest card (a tenuki two-cycle) for either colour', () => {
    // Q16 tenuki tenuki returns to Q16, the shallower node of the cycle: the second tenuki is the back edge.
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 1 },
      { line: ['Q16'], move: 'tenuki', p: 0.4 },
      { line: ['Q16'], move: 'R14', p: 0.4 },
      { line: ['Q16', 'tenuki'], move: 'tenuki', p: 0.6 },
      { line: ['Q16', 'tenuki'], move: 'R14', p: 0.4 },
    ]
    const book = weightedBook(edges, { a: ['Q16'] })
    // Black: Q16's rest (0.2); at Q16 tenuki the move card (0.4), the share of the tenuki back to the rest card (0.24) and
    // R14's rest (0.16); the leaf Q16 R14, its move and rest cards (0.4 each).
    const black = progress(book, 'B', [
      ['move', ['Q16', 'tenuki'], card(0.5)],
      ['rest', ['Q16', 'tenuki'], card(1)],
    ])
    expect(black.positions).toEqual({ a: entry((0.4 * 0.5 + 0.24) / 1.8, 1) })
    // White: Q16's move card (1), its good edges halved; White's tenuki back at Q16 tenuki to its rest card (0.3), the
    // leaf after R14 with White to move (0.2 and 0.2), and the rest card of the leaf Q16 R14 (0.5).
    const white = progress(book, 'W', [
      ['move', ['Q16'], card(1)],
      ['rest', ['Q16', 'tenuki'], card(0.5)],
    ])
    expect(white.positions).toEqual({ a: entry((1 + 0.3 * 0.5) / 2.2, 1) })
  })

  it('shares a player node equally between good edges the level gives no probability', () => {
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 0 },
      { line: [], move: 'R16', p: 0, category: 'good' },
      { line: [], move: 'R17', p: 0.4, category: 'bad' },
    ]
    const book = weightedBook(edges, { q: ['Q16'] })
    expect(progress(book, 'B', [['rest', ['Q16'], card(0.5)]]).positions).toEqual({ q: entry(0.5, 0.5) })
    expect(progress(book, 'W').positions).toEqual({ q: entry(0, 0) })
  })

  it('marks a position due when a card it reaches is due, and counts those positions', () => {
    const edges: WeightedEdge[] = [
      { line: [], move: 'Q16', p: 1 },
      { line: ['Q16'], move: 'R14', p: 0.6 },
      { line: ['Q16', 'R14'], move: 'O16', p: 0.4 },
      { line: ['Q16', 'R14'], move: 'S18', p: 0.2, category: 'bad' },
    ]
    const book = weightedBook(edges, { a: ['Q16'], p: ['Q16', 'R14'] })
    const due = (cards: Cards) => {
      const view = progress(book, 'B', cards)
      return [view.positions.a.due, view.positions.p.due, view.overall.due]
    }
    expect(due([])).toEqual([false, false, 0])
    expect(due([['rest', ['Q16', 'R14', 'O16'], card(0, EARLIER)]])).toEqual([true, true, 2])
    expect(due([['rest', ['Q16'], card(0, EARLIER)]])).toEqual([true, false, 1])
    expect(due([['move', ['Q16', 'R14'], card(0.5, NOW.toISOString())]])).toEqual([true, true, 2])
    // Not reached (a bad move of Black's), or not due yet.
    expect(due([['rest', ['Q16', 'R14', 'S18'], card(0, EARLIER)], ['rest', ['Q16', 'R14', 'O16'], card(0, LATER)]])).toEqual([false, false, 0])
  })

  it('has nothing without weights, for a level the weights do not have, or without a graph', () => {
    const nothing = (color: Color) => ({ hasWeights: false, level: '5k', color, overall: { percent: 0, due: 0 }, positions: {} })
    expect(progress(GraphBook.load(encodeGraph(testGraph()), null), 'B')).toEqual(nothing('B'))
    expect(progress(GraphBook.empty(), 'W')).toEqual(nothing('W'))
    const other = weightedBook([{ line: [], move: 'Q16', p: 1 }], { q: ['Q16'] }, '1d')
    expect(progress(other, 'B')).toEqual(nothing('B'))
  })
})
