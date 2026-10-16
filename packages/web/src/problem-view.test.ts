import { translator, type ProblemAnswer, type ProblemView, type Vertex } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { pvMoves } from './board-maps'
import { problemMarks, problemVerdict } from './problem-view'

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
  repetition: { cardId: 'card1', reviewId: 1, auto: 'hard', rating: 'hard', worst: { category: 'inaccuracy', loss: 0.8 }, editable: true, due: '2026-10-16T10:10:00.000Z' },
  ...over,
})

describe('problemMarks', () => {
  it('marks the last setup move before the answer', () => {
    expect(problemMarks(problem(), null, null)).toEqual([{ vertex: [16, 2], marker: { type: 'point' } }])
  })

  it('marks nothing before the answer to a problem on the very first move', () => {
    expect(problemMarks(problem({ moves: [] }), null, null)).toEqual([])
  })

  it('does not mark a pass as the last setup move', () => {
    expect(problemMarks(problem({ moves: [...problem().moves, { color: 'W', vertex: 'pass' }] }), null, null)).toEqual([])
  })

  it('marks the answer, KataGo’s best move and the move played in the training', () => {
    expect(problemMarks(problem(), answer([14, 2]), null)).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [15, 2], marker: { type: 'triangle' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })

  it('has no triangle when the answer is KataGo’s best move', () => {
    expect(problemMarks(problem(), answer([15, 2], { loss: 0, category: 'exact', best: true }), null)).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [15, 2], marker: { type: 'circle' } },
    ])
  })

  it('lets the answer’s circle win over the training’s cross when the same move is played again', () => {
    expect(problemMarks(problem(), answer([13, 2]), null)).toEqual([
      { vertex: [13, 2], marker: { type: 'circle' } },
      { vertex: [15, 2], marker: { type: 'triangle' } },
    ])
  })

  it('has no cross for an unpunished mistake of the opponent', () => {
    expect(problemMarks(problem({ source: 'unpunished' }), answer([14, 2]), null)).toEqual([
      { vertex: [15, 2], marker: { type: 'triangle' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })

  it('does not mark a pass as KataGo’s best move', () => {
    const a = answer([14, 2])
    expect(problemMarks(problem(), { ...a, line: { ...a.line, vertex: 'pass' } }, null)).toEqual([
      { vertex: [13, 2], marker: { type: 'cross' } },
      { vertex: [14, 2], marker: { type: 'circle' } },
    ])
  })

  it('numbers the moves of the shown line instead, a pass keeping its number but no mark', () => {
    const line = pvMoves('B', [[15, 2], 'pass', [14, 2]], 3)
    expect(problemMarks(problem(), answer([14, 2]), line)).toEqual([
      { vertex: [15, 2], marker: { type: 'label', label: '1' } },
      { vertex: [14, 2], marker: { type: 'label', label: '3' } },
    ])
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
