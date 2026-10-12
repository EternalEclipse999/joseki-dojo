import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORNERS, gtpToVertex, type Corner, type MoveVertex, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { mulberry32 } from '../bot/rng'
import { decodeJdb, encodeJdb, fromTopRight, JdbError, mirrorDiagonal, needsMirror, trapId, type JdbNode, type JdbTree } from '../jdb'
import { TrapBook } from './book'
import { testTrapsTree, writeTestTraps } from './fixture'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const ID1 = trapId(['Q16', 'O17', 'O18'].map(v))
const ID2 = trapId([...['Q16', 'O17', 'Q14', 'R18'].map(v)])
const book = TrapBook.fromBase(decodeJdb(encodeJdb(testTrapsTree())))
const board = (m: Vertex, corner: Corner, mirror: boolean): Vertex => fromTopRight(mirror ? mirrorDiagonal(m) : m, corner)
function node(gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode {
  return { move: gtp === 'tenuki' ? 'tenuki' : v(gtp), category, loss: null, children }
}
const COMBOS = CORNERS.flatMap((corner) => [false, true].map((mirror) => ({ corner, mirror })))

describe('fixture', () => {
  it('keeps every trap path canonical', () => {
    const base = decodeJdb(encodeJdb(testTrapsTree()))
    const paths = base.nodesOf('trap').map((i) => base.path(i))
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(needsMirror(path)).toBe(false)
  })
})

describe('TrapBook basics', () => {
  it('lists the traps of the base', () => {
    expect(book.count).toBe(2)
    expect(book.verified).toBe(true)
    expect(book.ids().sort()).toEqual([ID1, ID2].sort())
  })
  it('is empty without a base', () => {
    const e = TrapBook.empty()
    expect([e.count, e.verified, e.ids(), e.pick(() => 0, () => 0.5)]).toEqual([0, false, [], null])
  })
  it('loads a file and throws for a bad one', () => {
    const dir = tempDir()
    writeTestTraps(join(dir, 'traps.jdb'))
    expect(TrapBook.load(join(dir, 'traps.jdb')).count).toBe(2)
    writeFileSync(join(dir, 'bad.jdb'), 'not a base at all, really')
    expect(() => TrapBook.load(join(dir, 'bad.jdb'))).toThrow(JdbError)
    expect(() => TrapBook.load(join(dir, 'missing.jdb'))).toThrow()
  })
  it('rejects a base of another kind', () => {
    const file = join(tempDir(), 'starts.jdb')
    writeFileSync(file, encodeJdb({ kind: 'starts', verified: true, roots: [node('Q16', 'none')] }))
    expect(() => TrapBook.load(file)).toThrow(JdbError)
    expect(() => TrapBook.load(file)).toThrow(/не база ловушек/)
  })
  it('knows its ids', () => {
    expect(book.has(ID1)).toBe(true)
    expect(book.has('deadbeef')).toBe(false)
    expect(TrapBook.empty().has(ID1)).toBe(false)
  })
})

describe('place', () => {
  it('puts the trap in the top-right corner as it is stored', () => {
    const p = book.place(ID1, 'TR', 'W', false)
    expect(p.initialMoves).toEqual([
      { color: 'B', vertex: v('Q16') },
      { color: 'W', vertex: v('O17') },
    ])
    expect(p.trick).toEqual({ color: 'B', vertex: v('O18') })
    expect(p.placement).toEqual({ corner: 'TR', mirror: false, swapColors: false })
  })
  it('swaps the colours when the user picks the trick colour', () => {
    const p = book.place(ID1, 'TR', 'B', false)
    expect(p.initialMoves.map((m) => m.color)).toEqual(['W', 'B'])
    expect(p.trick.color).toBe('W')
    expect(p.placement.swapColors).toBe(true)
  })
  it('keeps the user as the answering side for a trick played by White', () => {
    expect(book.place(ID2, 'TR', 'B', false).trick.color).toBe('W')
    expect(book.place(ID2, 'TR', 'B', false).placement.swapColors).toBe(false)
    expect(book.place(ID2, 'TR', 'W', false).trick.color).toBe('B')
    expect(book.place(ID2, 'TR', 'W', false).placement.swapColors).toBe(true)
  })
  it.each(COMBOS)('lands in the right place: $corner mirror=$mirror', ({ corner, mirror }) => {
    const p = book.place(ID2, corner, 'B', mirror)
    expect([...p.initialMoves, p.trick].map((m) => m.vertex)).toEqual(['Q16', 'O17', 'Q14', 'R18'].map((g) => board(v(g), corner, mirror)))
  })
  it('puts the moves on literal board points (corner BL, mirrored, user Black)', () => {
    // Stored (top-right): Q16 = [15,3], O17 = [13,2], O18 = [13,1]; Black plays Q16 and O18, White plays O17.
    // Diagonal mirror [x,y] -> [18-y,18-x]: [15,3] -> [15,3], [13,2] -> [16,5], [13,1] -> [17,5].
    // Corner BL flips both axes [x,y] -> [18-x,18-y]: [3,15] (D4), [2,13] (C6), [1,13] (B6).
    // The trick (O18) is played by Black and the user is Black, so the colours swap: Q16 W, O17 B, O18 W.
    const p = book.place(ID1, 'BL', 'B', true)
    expect(p.initialMoves).toEqual([
      { color: 'W', vertex: [3, 15] },
      { color: 'B', vertex: [2, 13] },
    ])
    expect(p.trick).toEqual({ color: 'W', vertex: [1, 13] })
    expect(p.placement).toEqual({ corner: 'BL', mirror: true, swapColors: true })
  })
  it('mirrors in the diagonal', () => {
    expect(book.place(ID1, 'TR', 'W', true).trick.vertex).toEqual(mirrorDiagonal(v('O18')))
  })
  it('rejects an unknown id', () => {
    expect(() => book.place('deadbeef', 'TR', 'B', false)).toThrow()
  })
})

describe('answers and verdict', () => {
  it.each(COMBOS)('maps answers to the board: $corner mirror=$mirror', ({ corner, mirror }) => {
    const pl = book.place(ID1, corner, 'W', mirror).placement
    const a = book.answers(ID1, pl)
    expect(a.good).toEqual([board(v('P17'), corner, mirror), board(v('P18'), corner, mirror)])
    expect(a.caught).toEqual([board(v('N18'), corner, mirror)])
    const b = book.answers(ID2, book.place(ID2, corner, 'B', mirror).placement)
    expect(b.good).toEqual([board(v('R17'), corner, mirror), 'pass'])
    expect(b.caught).toEqual([board(v('Q18'), corner, mirror)])
  })

  describe.each(COMBOS)('verdict: $corner mirror=$mirror', ({ corner, mirror }) => {
    for (const color of ['B', 'W'] as const) {
      it(`user ${color}`, () => {
        const verdict = (id: string, m: MoveVertex): string => book.verdict(id, book.place(id, corner, color, mirror).placement, m)
        expect(verdict(ID1, board(v('P17'), corner, mirror))).toBe('correct')
        expect(verdict(ID1, board(v('P18'), corner, mirror))).toBe('correct')
        expect(verdict(ID1, board(v('N18'), corner, mirror))).toBe('caught')
        expect(verdict(ID1, board(v('N10'), corner, mirror))).toBe('other') // in the zone, not in the base
        expect(verdict(ID1, 'pass')).toBe('other') // tenuki is not an answer of the first trap
        expect(verdict(ID1, fromTopRight([3, 15], corner))).toBe('other') // outside the zone
        expect(verdict(ID2, board(v('R17'), corner, mirror))).toBe('correct')
        expect(verdict(ID2, board(v('Q18'), corner, mirror))).toBe('caught')
        expect(verdict(ID2, 'pass')).toBe('correct')
        expect(verdict(ID2, fromTopRight([3, 15], corner))).toBe('correct') // outside the zone counts as a tenuki
      })
    }
  })
})

describe('pick', () => {
  it('draws an unseen trap about twice as often as one seen once', () => {
    const rng = mulberry32(42)
    const shows = (id: string): number => (id === ID1 ? 1 : 0)
    const n = 6000
    let unseen = 0
    for (let i = 0; i < n; i++) if (book.pick(shows, rng) === ID2) unseen++
    expect(unseen / (n - unseen)).toBeGreaterThan(1.8)
    expect(unseen / (n - unseen)).toBeLessThan(2.2)
  })
  it('returns the last id when the draw lands at the very top of the range', () => {
    const ids = book.ids()
    expect(book.pick(() => 0, () => 0.9999999)).toBe(ids[ids.length - 1])
    expect(book.pick(() => 0, () => 0)).toBe(ids[0])
  })
  it('uses one rng draw', () => {
    let calls = 0
    book.pick(() => 0, () => (calls++, 0.1))
    expect(calls).toBe(1)
  })
})

describe('playable traps only', () => {
  const answers = (): JdbNode[] => [node('P17', 'good'), node('N18', 'caught')]
  const tree: JdbTree = {
    kind: 'traps',
    verified: true,
    roots: [
      node('Q16', 'none', [
        node('Q16', 'trap', answers()), // the trick lands on a taken point
        node('tenuki', 'none', [node('O17', 'trap', answers())]), // a tenuki on the way
        node('O17', 'none', [node('O18', 'trap', [node('P17', 'good'), node('P18', 'good')])]), // no caught answer
        node('R17', 'trap', answers()), // fine
        node('R16', 'trap', [node('P17', 'caught'), node('N18', 'caught')]), // no good answer
      ]),
      node('O18', 'trap', answers()), // no move before the trick
    ],
  }
  const crafted = TrapBook.fromBase(decodeJdb(encodeJdb(tree)))

  it('keeps only the traps that can be played', () => {
    expect(crafted.count).toBe(1)
    expect(crafted.ids()).toEqual([trapId(['Q16', 'R17'].map(v))])
  })
  it('records the skipped ids', () => {
    expect(crafted.skipped).toHaveLength(5)
    expect(crafted.skipped).toContain(trapId(['O18'].map(v)))
    expect(crafted.skipped).toContain(trapId([v('Q16'), v('Q16')]))
    expect(crafted.skipped).toContain(trapId([v('Q16'), 'tenuki', v('O17')]))
    expect(crafted.skipped).toContain(trapId(['Q16', 'O17', 'O18'].map(v)))
    expect(crafted.skipped).not.toContain(trapId(['Q16', 'R17'].map(v)))
  })
  it('skips nothing in a sound base', () => {
    expect(book.skipped).toEqual([])
  })
})

describe('a symmetric trap', () => {
  // Q16 and R17 both lie on the diagonal, so the trap reads the same in both orientations.
  const symmetric = TrapBook.fromBase(
    decodeJdb(encodeJdb({ kind: 'traps', verified: true, roots: [node('Q16', 'none', [node('R17', 'trap', [node('P17', 'good'), node('N18', 'caught')])])] })),
  )
  const SID = symmetric.ids()[0]

  it.each(COMBOS)('accepts an answer and its mirror image: $corner mirror=$mirror', ({ corner, mirror }) => {
    for (const color of ['B', 'W'] as const) {
      const placement = symmetric.place(SID, corner, color, mirror).placement
      const verdict = (m: Vertex): string => symmetric.verdict(SID, placement, fromTopRight(m, corner))
      expect(verdict(v('P17'))).toBe('correct')
      expect(verdict(mirrorDiagonal(v('P17')))).toBe('correct')
      expect(verdict(v('N18'))).toBe('caught')
      expect(verdict(mirrorDiagonal(v('N18')))).toBe('caught')
      expect(verdict(v('N10'))).toBe('other')
    }
  })
  it('lists both orientations of the answers', () => {
    const a = symmetric.answers(SID, { corner: 'TR', mirror: false, swapColors: false })
    expect(a.good).toEqual([v('P17'), mirrorDiagonal(v('P17'))])
    expect(a.caught).toEqual([v('N18'), mirrorDiagonal(v('N18'))])
  })
  it('does not mirror the answers of an asymmetric trap', () => {
    expect(book.answers(ID1, { corner: 'TR', mirror: false, swapColors: false }).good).toEqual([v('P17'), v('P18')])
    expect(book.verdict(ID1, { corner: 'TR', mirror: false, swapColors: false }, mirrorDiagonal(v('P17')))).toBe('other')
  })
})
