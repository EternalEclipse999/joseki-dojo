import { describe, expect, it } from 'vitest'
import { lineKey } from '../graph/fixture'
import type { ZoneMove } from '../graph/key'
import { weightedBook } from '../progress/fixture'
import type { GraphReview } from '../progress/repo'
import { habitCounts, habitShares } from './habits'

/**
 * The empty corner (Black) leads to N1 by Q16 and to N2 by R16. At N1 (White) A = R14 (ideal) and B = R17 (good) are its
 * good edges, played with probabilities `a` and `b`, and C = Q14 (bad) is not; at N2 (White) the only edge is bad.
 */
function habitBook(a = 0.3, b = 0.1) {
  const book = weightedBook([
    { line: [], move: 'Q16', p: 0.5 },
    { line: [], move: 'R16', p: 0.5 },
    { line: ['Q16'], move: 'R14', p: a },
    { line: ['Q16'], move: 'R17', p: b, category: 'good' },
    { line: ['Q16'], move: 'Q14', p: 0.2, category: 'bad' },
    { line: ['R16'], move: 'Q14', p: 0.4, category: 'bad' },
  ])
  const n1 = book.node(lineKey(['Q16']))!
  const n2 = book.node(lineKey(['R16']))!
  const [A, B, C] = book.edges(n1).map((e) => e.move)
  return { book, n1, n2, A, B, C, D: book.edges(n2)[0].move, level: book.levelArrays('5k')! }
}

let id = 0
/** A move review of White at `key` whose move is `move` (none: a review older than the moves kept). */
const review = (key: string, move: ZoneMove | undefined, over: Partial<GraphReview> = {}): GraphReview => ({
  id: ++id,
  cardKey: key,
  kind: 'move',
  color: 'W',
  reviewedAt: '2026-10-22T10:00:00.000Z',
  sessionId: `s${id}`,
  manual: null,
  auto: 'good',
  raw: move === undefined ? { loss: 0, best: false } : { loss: 0, best: false, move },
  ...over,
})

describe('habitCounts and habitShares', () => {
  it("count the player's good moves of each node and share them out (part 3 spec 4)", () => {
    const { book, n1, n2, A, B, C, D, level } = habitBook()
    const k1 = book.nodeKey(n1)
    const reviews = [
      review(k1, A),
      review(k1, A),
      review(k1, B),
      // A mistake, a move off the edges, a review without the move: nothing.
      review(k1, C),
      review(k1, 'tenuki'),
      review(k1, undefined),
      // Another colour, a rest review, a key outside the graph: nothing.
      review(k1, B, { color: 'B' }),
      review(k1, A, { kind: 'rest' }),
      review(lineKey(['Q16', 'R14', 'O16']), A),
      // N2 has no good edge.
      review(book.nodeKey(n2), D),
    ]
    const counts = habitCounts(book, reviews, 'W')
    expect([...counts]).toEqual([[n1, Float64Array.of(2, 1, 0)]])
    const shares = habitShares(book, counts, level)
    expect(shares(n1)).toEqual(Float64Array.of(2 / 3, 1 / 3, 0))
    expect(shares(n1)).toBe(shares(n1))
    expect(shares(n2)).toEqual(Float64Array.of(0))
    // Black's review counts for Black only.
    expect([...habitCounts(book, reviews, 'B')]).toEqual([[n1, Float64Array.of(0, 1, 0)]])
  })

  it("share the good edges by the level's probabilities without the player's moves, equally when they are 0", () => {
    const { book, n1, n2, level } = habitBook()
    const shares = habitShares(book, new Map(), level)
    const [a, b, c] = shares(n1)
    expect(a).toBeCloseTo(0.75, 4) // the weights file quantises 0.3 and 0.1
    expect(b).toBeCloseTo(0.25, 4)
    expect(c).toBe(0)
    expect(shares(n2)).toEqual(Float64Array.of(0))
    const zero = habitBook(0, 0)
    expect(habitShares(zero.book, new Map(), zero.level)(zero.n1)).toEqual(Float64Array.of(0.5, 0.5, 0))
  })
})
