import type { Marker } from '@sabaki/shudan'
import { translator, type ProblemAnswer, type ProblemView, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { emptyMap } from './board-maps'
import { problemMarks, problemVariationNumbers, problemVerdict, withVerdictMarks, type BoardMarks } from './problem-view'

const t = translator('ru')

/** Black to move after B Q16, W R17; in the training Black played O17. */
const problem = (over: Partial<ProblemView> = {}): ProblemView => ({
  source: 'mistake',
  corner: 'TR',
  userColor: 'B',
  moves: [
    { color: 'B', vertex: [15, 3] },
    { color: 'W', vertex: [16, 2] },
  ],
  userMove: [13, 2],
  userLoss: 2.4,
  moveNumber: 3,
  group: '4-4',
  ...over,
})

/** An inaccuracy at `vertex`; KataGo's best move is Q17. */
const answer = (vertex: Vertex, over: Partial<ProblemAnswer> = {}): ProblemAnswer => ({
  vertex,
  loss: 0.8,
  category: 'inaccuracy',
  best: false,
  line: { vertex: [15, 2], loss: 0, pv: [[15, 2], [16, 3], [14, 2]] },
  position: { turn: 0, scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: [15, 2], loss: 0, pv: [[15, 2], [16, 3], [14, 2]] }], ownership: null },
  leadAfter: -0.8,
  repetition: { cardId: 'card1', reviewId: 1, auto: 'hard', rating: 'hard', worst: { category: 'inaccuracy', loss: 0.8 }, editable: true, due: '2026-10-16T10:10:00.000Z' },
  ...over,
})

describe('problemMarks', () => {
  it('marks the last setup move before the answer', () => {
    expect(problemMarks(problem(), null)).toEqual([{ vertex: [16, 2], marker: { type: 'point' } }])
  })

  it('marks nothing before the answer to a problem on the very first move', () => {
    expect(problemMarks(problem({ moves: [] }), null)).toEqual([])
  })

  it('does not mark a pass as the last setup move', () => {
    expect(problemMarks(problem({ moves: [...problem().moves, { color: 'W', vertex: 'pass' }] }), null)).toEqual([])
  })

  it('marks the answer, KataGo’s best move and the move played in the training', () => {
    expect(problemMarks(problem(), answer([14, 2]))).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [15, 2], marker: { type: 'triangle' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })

  it('has no triangle when the answer is KataGo’s best move', () => {
    expect(problemMarks(problem(), answer([15, 2], { loss: 0, category: 'exact', best: true }))).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [15, 2], marker: { type: 'circle' } },
    ])
  })

  it('lets the answer’s circle win over the training’s cross when the same move is played again', () => {
    expect(problemMarks(problem(), answer([13, 2]))).toEqual([
      { vertex: [13, 2], marker: { type: 'circle' } },
      { vertex: [15, 2], marker: { type: 'triangle' } },
    ])
  })

  it('has no cross for an unpunished mistake of the opponent', () => {
    expect(problemMarks(problem({ source: 'unpunished' }), answer([14, 2]))).toEqual([
      { vertex: [15, 2], marker: { type: 'triangle' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })

  it('does not mark a pass as KataGo’s best move', () => {
    const a = answer([14, 2])
    expect(problemMarks(problem(), { ...a, line: { ...a.line, vertex: 'pass' } })).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })
})

describe('withVerdictMarks', () => {
  /**
   * The «Ваш ответ» board the variations give for answer P17 (black, [14, 2]): its point on the answer; the letters A on
   * KataGo's best move Q17, B on the training's O17 and C on K10, B and C faded.
   */
  const hookBoard = (): BoardMarks => {
    const markers = emptyMap<Marker | null>(null)
    markers[2][14] = { type: 'point' }
    markers[2][15] = { type: 'label', label: 'A' }
    markers[2][13] = { type: 'label', label: 'B' }
    markers[9][9] = { type: 'label', label: 'C' }
    return { markers, dimmed: [[13, 2], [9, 9]] }
  }

  it('puts the circle on the answer instead of its point, the triangle and the cross instead of the letters', () => {
    const { markers } = withVerdictMarks(problem(), answer([14, 2]), hookBoard())
    expect(markers[2][14]).toEqual({ type: 'circle' })
    expect(markers[2][15]).toEqual({ type: 'triangle' })
    expect(markers[2][13]).toEqual({ type: 'cross' })
  })

  it('keeps the other letters, and fades only the points without a verdict mark', () => {
    const { markers, dimmed } = withVerdictMarks(problem(), answer([14, 2]), hookBoard())
    expect(markers[9][9]).toEqual({ type: 'label', label: 'C' })
    expect(markers.flat().filter((m) => m !== null)).toHaveLength(4)
    expect(dimmed).toEqual([[9, 9]])
  })

  it('leaves the letter on the training’s move of an unpunished mistake, which has no cross', () => {
    const { markers, dimmed } = withVerdictMarks(problem({ source: 'unpunished' }), answer([14, 2]), hookBoard())
    expect(markers[2][13]).toEqual({ type: 'label', label: 'B' })
    expect(dimmed).toEqual([[13, 2], [9, 9]])
  })

  it('does not change the board it is given', () => {
    const board = hookBoard()
    withVerdictMarks(problem(), answer([14, 2]), board)
    expect(board).toEqual(hookBoard())
  })
})

describe('problemVariationNumbers', () => {
  const R4: Vertex = [16, 15]
  const D4: Vertex = [3, 15]

  it('numbers a variation from the start view (fromTurn 0) from the problem’s move', () => {
    const v = { fromTurn: 0, originTurn: -1, moves: [R4, D4], step: 1 }
    expect(problemVariationNumbers(problem(), v)).toEqual({ from: 3, move: 3 })
    expect(problemVariationNumbers(problem(), { ...v, step: 2 })).toEqual({ from: 3, move: 4 })
  })

  it('numbers a variation after the answer (fromTurn 1) from the move after the problem’s', () => {
    const v = { fromTurn: 1, originTurn: 0, moves: [R4, D4], step: 1 }
    expect(problemVariationNumbers(problem(), v)).toEqual({ from: 4, move: 4 })
    expect(problemVariationNumbers(problem(), { ...v, step: 2 })).toEqual({ from: 4, move: 5 })
  })

  it('numbers the variations of a problem on the very first move as the review does', () => {
    const p = problem({ moves: [], moveNumber: 1 })
    expect(problemVariationNumbers(p, { fromTurn: 0, originTurn: -1, moves: [R4], step: 1 })).toEqual({ from: 1, move: 1 })
    expect(problemVariationNumbers(p, { fromTurn: 1, originTurn: 0, moves: [R4, D4], step: 2 })).toEqual({ from: 2, move: 3 })
  })
})

describe('problemVerdict', () => {
  it('names KataGo’s best move', () => {
    expect(problemVerdict(answer([15, 2], { loss: 0, category: 'exact', best: true }), t, 'ru')).toBe('Это лучший ход KataGo')
  })

  it('gives the category with the points lost', () => {
    expect(problemVerdict(answer([14, 2]), t, 'ru')).toBe('неточность, −0,8')
  })

  it('does not print a loss that rounds to zero', () => {
    expect(problemVerdict(answer([14, 2], { loss: 0.04, category: 'exact' }), t, 'ru')).toBe('точно')
  })

  it('speaks the reader’s language and writes numbers its way', () => {
    expect(problemVerdict(answer([10, 10], { loss: 2.5, category: 'mistake' }), translator('en'), 'en')).toBe('mistake, −2.5')
  })
})
