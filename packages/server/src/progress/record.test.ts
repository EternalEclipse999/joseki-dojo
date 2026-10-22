import type { ReviewData } from '@joseki-dojo/shared'
import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { newState } from '../cards/schedule'
import { GraphBook } from '../graph/book'
import { CYCLE_LIST_ID, cycleGraph, lineKey } from '../graph/fixture'
import { encodeGraph, encodeWeights } from '../graph/format'
import type { SessionRecord } from '../store/records'
import { computeProgress } from './compute'
import { keyBefore, TEST_THRESHOLDS as TH, training, uniformWeights, walkBook, type Step, type TrainingShape } from './fixture'
import { moveRating, restRating, walkTraining, type TrainingWalk } from './record'

const book = walkBook()
const key = (node: number): string => book.nodeKey(node)
const walk = ([rec, review]: [SessionRecord, ReviewData], seen: (key: string) => boolean = () => false, origin = 0) => walkTraining(rec, review, book, seen, TH, origin)
const keysOf = (w: TrainingWalk): string[] => [...w.moves.map((m) => m.key), ...(w.rest ? [w.rest.key, ...w.rest.raw.moves.map((m) => m.key), ...w.rest.raw.opponent.map((o) => o.key)] : []), ...w.met]

describe('moveRating', () => {
  it('rates a move card by the move (spec 3.2)', () => {
    const rate = (loss: number, best = false) => moveRating({ loss, best }, TH)
    expect([rate(0.7, true), rate(0.3), rate(0.7), rate(2), rate(6)]).toEqual(['easy', 'good', 'hard', 'again', 'again'])
  })
})

describe('restRating', () => {
  const m = (loss: number, seenBefore = true) => ({ loss, key: 'k', seenBefore })
  const o = (loss: number, replyLoss: number, seenBefore = true) => ({ loss, replyLoss, key: 'k', seenBefore })

  it('rates by the worst player move after leaving the graph (spec 3.3)', () => {
    expect(restRating({ moves: [m(0), m(0.3)], opponent: [] }, TH)).toBe('good')
    expect(restRating({ moves: [m(0), m(0.7)], opponent: [] }, TH)).toBe('hard')
    expect(restRating({ moves: [m(0.7), m(2.5)], opponent: [] }, TH)).toBe('again')
    expect(restRating({ moves: [m(6)], opponent: [] }, TH)).toBe('again')
  })

  it('counts an unpunished opponent mistake as a mistake, and neither a punished one nor an opponent move below a mistake', () => {
    expect(restRating({ moves: [m(0)], opponent: [o(3, 1.5)] }, TH)).toBe('again')
    expect(restRating({ moves: [], opponent: [o(3, 1.5)] }, TH)).toBe('again')
    expect(restRating({ moves: [m(0)], opponent: [o(3, 0.5)] }, TH)).toBe('good')
    expect(restRating({ moves: [m(0)], opponent: [o(1.5, 1.5)] }, TH)).toBe('good')
  })

  it('rates «hard» when every mistake was made at a position met for the first time', () => {
    expect(restRating({ moves: [m(2.5, false), m(6, false), m(0.7)], opponent: [] }, TH)).toBe('hard')
    expect(restRating({ moves: [m(2.5, false), m(2.5)], opponent: [] }, TH)).toBe('again')
    expect(restRating({ moves: [m(0)], opponent: [o(3, 1.5, false)] }, TH)).toBe('hard')
    expect(restRating({ moves: [m(2.5, false)], opponent: [o(3, 1.5)] }, TH)).toBe('again')
  })
})

describe('walkTraining', () => {
  it('reviews the move card of every node where the player moved, rated by the move', () => {
    expect(walk(training([['Q16', 0.7, true], ['R14'], ['O16', 0.7]]))).toEqual({
      color: 'B',
      moves: [
        { key: key(0), raw: { loss: 0.7, best: true }, auto: 'easy' },
        { key: key(2), raw: { loss: 0.7, best: false }, auto: 'hard' },
      ],
      rest: null,
      met: [],
    })
    expect(walk(training([['Q16', 0.3], ['R14'], ['O16', 2.5]])).moves.map((m) => m.auto)).toEqual(['good', 'again'])
  })

  it('leaves the graph on a move that is not an edge: the rest card of its node, by the moves after it', () => {
    // Node 4 has no White R12; White's tenuki after Black's Q12 is outside the zone.
    const t = training([['Q16'], ['R14'], ['O16'], ['R12'], ['Q12', 0.3], ['tenuki'], ['P13', 0.7]])
    const [rec] = t
    const w = walk(t)
    expect(w.moves.map((m) => m.key)).toEqual([key(0), key(2)])
    expect(w.rest).toEqual({
      key: key(4),
      raw: {
        moves: [{ loss: 0.3, key: keyBefore(rec, 4), seenBefore: false }, { loss: 0.7, key: keyBefore(rec, 6), seenBefore: false }],
        opponent: [{ loss: 0, replyLoss: 0.3, key: keyBefore(rec, 4), seenBefore: false }],
      },
      auto: 'hard',
    })
    // The player's decision positions after the leaving move only: not the exit node, not White's turns.
    expect(w.met).toEqual([keyBefore(rec, 4), keyBefore(rec, 6)])
  })

  it('leaves the graph on an edge without a node', () => {
    const t = training([['Q16'], ['R17'], ['Q17', 0.3]])
    const after = keyBefore(t[0], 2)
    expect(walk(t)).toEqual({
      color: 'B',
      moves: [{ key: key(0), raw: { loss: 0, best: false }, auto: 'good' }],
      rest: { key: key(1), raw: { moves: [{ loss: 0.3, key: after, seenBefore: false }], opponent: [{ loss: 0, replyLoss: 0.3, key: after, seenBefore: false }] }, auto: 'good' },
      met: [after],
    })
  })

  it('leaves the graph on a back edge (a tenuki two-cycle)', () => {
    // The user's tenuki at node 3 returns to node 1, the shallower node of the cycle: the edge that cuts it.
    const t = training([['Q16'], ['tenuki'], ['tenuki', 1], ['R14'], ['O16']])
    const w = walk(t)
    expect(w.moves).toEqual([
      { key: key(0), raw: { loss: 0, best: false }, auto: 'good' },
      { key: key(3), raw: { loss: 1, best: false }, auto: 'hard' },
    ])
    const after = keyBefore(t[0], 4)
    expect(w.rest).toEqual({ key: key(3), raw: { moves: [{ loss: 0, key: after, seenBefore: false }], opponent: [{ loss: 0, replyLoss: 0, key: after, seenBefore: false }] }, auto: 'good' })
  })

  it('reviews the player move that leaves the graph by its move card only', () => {
    // Black's P14 is not an edge of node 2.
    const t = training([['Q16'], ['R14'], ['P14', 2.5], ['R13'], ['Q13']])
    expect(walk(t)).toMatchObject({
      moves: [{ key: key(0) }, { key: key(2), raw: { loss: 2.5, best: false }, auto: 'again' }],
      rest: { key: key(2), raw: { moves: [{ loss: 0, key: keyBefore(t[0], 4) }], opponent: [{ loss: 0, replyLoss: 0, key: keyBefore(t[0], 4) }] }, auto: 'good' },
      met: [keyBefore(t[0], 4)],
    })
  })

  it('reaches a node by a transposition under the same key', () => {
    const a = walk(training([['R14'], ['tenuki'], ['Q16'], ['R16']], { settings: { userColor: 'W' } }))
    const b = walk(training([['Q16'], ['tenuki'], ['R14'], ['R16']], { settings: { userColor: 'W' } }))
    expect(a.moves.map((m) => m.key)).toEqual([key(6), key(5)])
    expect(b.moves.map((m) => m.key)).toEqual([key(1), key(5)])
  })

  it('gives the same reviews in every corner, mirrored or not', () => {
    const steps: Step[] = [['Q16', 0, true], ['R14'], ['O16', 0.7], ['R12'], ['Q12', 2.5], ['tenuki'], ['P13']]
    const plain = walk(training(steps))
    expect(plain.moves.map((m) => m.key)).toEqual([key(0), key(2)])
    expect(plain.rest?.key).toBe(key(4))
    for (const corner of ['TL', 'TR', 'BL', 'BR'] as const) {
      expect(walk(training(steps, { settings: { corner } }))).toEqual(plain)
      expect(walk(training(steps, { settings: { corner }, mirror: true }))).toEqual(plain)
    }
  })

  it("walks a training that White starts as the one Black starts, under the colour of the player's role", () => {
    const steps: Step[] = [['Q16', 0, true], ['R14'], ['O16', 0.7], ['R12'], ['Q12', 2.5], ['tenuki'], ['P13']]
    const black = walk(training(steps))
    const white = walk(training(steps, { first: 'W', settings: { userColor: 'W' } }))
    expect(white).toEqual(black)
    expect(white.color).toBe('B')
    // The user who answers White's first move has White's role.
    const second = walk(training(steps, { first: 'W', settings: { userColor: 'B' } }))
    expect(second).toEqual(walk(training(steps, { settings: { userColor: 'W' } })))
    expect(second.color).toBe('W')
    // Nothing on the empty corner with White to move (node 8), whose White Q16 is an edge, or after it.
    for (const w of [white, second]) expect(keysOf(w).filter((k) => k === key(8) || k === key(9))).toEqual([])
  })

  it('walks the start moves of a training with swapped colours by role, without reviewing them', () => {
    const start = (shape: TrainingShape) => walk(training([['O16', 0.3], ['R12'], ['Q12', 2.5]], { initial: ['Q16', 'R14'], ...shape }), () => false, 2)
    const swapped = start({ first: 'W', settings: { mode: 'traps', userColor: 'W', trap: { id: 'trap', index: 2, mirror: false, swapColors: true } } })
    expect(swapped).toEqual(start({ settings: { mode: 'traps', userColor: 'B', trap: { id: 'trap', index: 2, mirror: false, swapColors: false } } }))
    expect(swapped).toMatchObject({ color: 'B', moves: [{ key: key(2) }], rest: { key: key(4), auto: 'hard' } })
  })

  it('gives no review to the start moves', () => {
    const t = training([['O16', 0.3]], { initial: ['Q16', 'R14'], settings: { mode: 'list' } })
    expect(walk(t, () => false, 2)).toEqual({ color: 'B', moves: [{ key: key(2), raw: { loss: 0.3, best: false }, auto: 'good' }], rest: null, met: [] })
  })

  it('counts nothing of a replay from move N', () => {
    const t = training([['O16', 0.3], ['R12'], ['Q12', 2.5]], { initial: ['Q16', 'R14'] })
    expect(walk(t, () => false, 0)).toEqual({ color: 'B', moves: [], rest: null, met: [] })
  })

  it('gives no rest review without a player move in the zone or an opponent mistake after leaving', () => {
    const t = training([['Q16'], ['R17'], ['tenuki', 3]])
    const w = walk(t)
    expect(w.rest).toBeNull()
    expect(w.met).toEqual([keyBefore(t[0], 2)])
  })

  it("keeps the opponent's leaving mistake with the position after it, «hard» when that position is new", () => {
    // White's R17 (an edge without a node) loses 3; Black's answer gives back only 1.5 of it.
    const t = training([['Q16'], ['R17', 3], ['Q17', 1.5]])
    const after = keyBefore(t[0], 2)
    expect(walk(t).rest).toEqual({
      key: key(1),
      raw: { moves: [{ loss: 1.5, key: after, seenBefore: false }], opponent: [{ loss: 3, replyLoss: 1.5, key: after, seenBefore: false }] },
      auto: 'hard',
    })
    expect(walk(t, (k) => k === after).rest?.auto).toBe('again')
    // The position before the mistake is the exit node: not the player's decision.
    expect(walk(t, (k) => k === key(1)).rest?.auto).toBe('hard')
  })

  it('keeps an opponent mistake after the leaving move, answered by a tenuki, at the position after it', () => {
    // After White's leaving R17, White's P17 loses 3 and Black answers it with a tenuki that gives back only 1.5.
    const t = training([['Q16'], ['R17'], ['Q17'], ['P17', 3], ['tenuki', 1.5], ['tenuki'], ['P16']])
    const [rec] = t
    const w = walk(t)
    expect(w.rest).toEqual({
      key: key(1),
      raw: {
        moves: [{ loss: 0, key: keyBefore(rec, 2), seenBefore: false }, { loss: 0, key: keyBefore(rec, 6), seenBefore: true }],
        opponent: [
          { loss: 0, replyLoss: 0, key: keyBefore(rec, 2), seenBefore: false },
          { loss: 3, replyLoss: 1.5, key: keyBefore(rec, 4), seenBefore: false },
        ],
      },
      auto: 'hard',
    })
    expect(w.met).toEqual([keyBefore(rec, 2), keyBefore(rec, 4)])
    expect(walk(t, (k) => k === keyBefore(rec, 4)).rest?.auto).toBe('again')
  })

  it('rates a player mistake after leaving «hard» at a new position, «again» at one met before or earlier in the training', () => {
    const t = training([['Q16'], ['R17'], ['Q17', 2.5]])
    expect(walk(t).rest?.auto).toBe('hard')
    expect(walk(t, (k) => k === keyBefore(t[0], 2)).rest).toMatchObject({ auto: 'again', raw: { moves: [{ seenBefore: true }] } })
    // Two tenukis bring the position before Black's tenuki back before Black's P16.
    const again = training([['Q16'], ['R17'], ['Q17'], ['tenuki'], ['tenuki'], ['tenuki'], ['P16', 2.5]])
    expect(walk(again).rest).toMatchObject({ auto: 'again', raw: { moves: [{ seenBefore: false }, { seenBefore: true }] } })
  })

  it('reviews nothing without a graph', () => {
    const [rec, review] = training([['Q16'], ['R14']])
    expect(walkTraining(rec, review, GraphBook.empty(), () => false, TH, 0)).toEqual({ color: 'B', moves: [], rest: null, met: [] })
  })
})

describe('walkTraining and the progress', () => {
  // cycleGraph(): X = Q16 R14 O16 R12 (Black to move, 4 moves deep) and Y, its stones with White to move (5 moves deep), a
  // tenuki apart both ways, Y entered by its own move order too; the cut is Y's tenuki back to X. At every node each edge
  // and the rest are equally likely.
  const graph = cycleGraph()
  const cycle = GraphBook.load(encodeGraph(graph), encodeWeights(uniformWeights(graph, ['5k']), graph))
  const X = lineKey(['Q16', 'R14', 'O16', 'R12'])
  const Y = lineKey(['Q16', 'R14', 'O16', 'R12', 'tenuki'])
  const NOW = new Date('2026-10-21T10:00:00.000Z')

  it('leaves a two-cycle on its cut edge wherever the training enters it, at the rest card the progress weighs', () => {
    const rest = (steps: Step[]) => walkTraining(...training(steps), cycle, () => false, TH, 0).rest?.key
    const tail: Step[] = [['tenuki'], ['tenuki'], ['P17'], ['O17', 0.7]]
    // Entered at X: Black's tenuki goes on to Y, White's tenuki back leaves the graph.
    expect(rest([['Q16'], ['R14'], ['O16'], ['R12'], ...tail])).toBe(Y)
    // Entered at Y (Black's tenuki at Q16 R14, O16 later): White's tenuki leaves at once, not Black's tenuki after it at X.
    expect(rest([['Q16'], ['R14'], ['tenuki'], ['R12'], ['O16'], ...tail])).toBe(Y)
    // For Black, Y's rest card takes all of Y's weight: half the plays from Q16 R14 reach Y (a quarter by each order), 0.5 of
    // the position's 2.5. X's rest card takes none.
    const learned = { ...newState(NOW), state: State.Review, reps: 1, stability: 21 } // a percent of 1
    const percent = (key: string) => computeProgress(cycle, '5k', 'B', (k, kind) => (k === key && kind === 'rest' ? learned : null), NOW).positions[CYCLE_LIST_ID].percent
    expect(percent(Y)).toBeCloseTo(0.2, 4) // thirds, quantised by the weights file
    expect(percent(X)).toBe(0)
  })
})
