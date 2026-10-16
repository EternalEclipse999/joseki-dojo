import type { Marker } from '@sabaki/shudan'
import type { Language, MoveVertex, ProblemAnswer, ProblemView, Translate, Vertex } from '@joseki-dojo/shared'
import { isVertex, sameVertex } from './board-maps'
import { CATEGORY_LABEL, formatPoints, ZERO_LOSS } from './format'
import { variationNumbers, type Variation, type VariationNumbers } from './variation'

/** A mark of the problem board. */
export interface ProblemMark {
  vertex: Vertex
  marker: Marker
}

/**
 * Repetition spec 5.4: the marks of the problem board, at most one per point. Before the answer the last setup move;
 * after it the answer (circle), KataGo's best move when it is another point (triangle) and, for the player's own
 * mistake, the move played in the training (cross): the answer's circle wins when the same move is played again. After
 * the answer they are the marks of the «Ваш ответ» view (problem variations 2.2). A pass has no point and no mark.
 */
export function problemMarks(problem: ProblemView, answer: ProblemAnswer | null): ProblemMark[] {
  const marks = new Map<string, ProblemMark>()
  const mark = (v: MoveVertex, marker: Marker): void => {
    if (isVertex(v)) marks.set(`${v[0]},${v[1]}`, { vertex: v, marker })
  }
  if (answer) {
    if (problem.source === 'mistake') mark(problem.userMove, { type: 'cross' })
    if (!sameVertex(answer.line.vertex, answer.vertex)) mark(answer.line.vertex, { type: 'triangle' })
    mark(answer.vertex, { type: 'circle' })
  } else {
    const last = problem.moves.at(-1)
    if (last) mark(last.vertex, { type: 'point' })
  }
  return [...marks.values()]
}

/** The marks of a board and its faded points. */
export interface BoardMarks {
  markers: (Marker | null)[][]
  dimmed: Vertex[]
}

/**
 * Problem variations 2.2: the «Ваш ответ» view (no variation and no branch open) keeps the verdict's marks over the ones
 * the variations give it: the circle replaces the answer's point, the triangle and the cross replace the candidates'
 * letters; a marked point is never faded. The given board is left as it is.
 */
export function withVerdictMarks(problem: ProblemView, answer: ProblemAnswer, board: BoardMarks): BoardMarks {
  const marks = problemMarks(problem, answer)
  const markers = board.markers.map((row) => row.slice())
  for (const { vertex, marker } of marks) markers[vertex[1]][vertex[0]] = marker
  return { markers, dimmed: board.dimmed.filter((v) => !marks.some((m) => sameVertex(m.vertex, v))) }
}

/**
 * Problem variations 2.2: a variation on the problem screen is numbered from the problem's move, as its facts («Ход N»)
 * are: game move 0, the answer or another first move from the start view, is move `problem.moveNumber`.
 */
export function problemVariationNumbers(problem: ProblemView, variation: Variation): VariationNumbers {
  return variationNumbers(variation, problem.moveNumber)
}

/**
 * Repetition spec 5.4: KataGo's verdict on the answer: its best move, or the answer's category with the points lost. A
 * loss that rounds to zero is not printed, as in the review's move line.
 */
export function problemVerdict(answer: ProblemAnswer, t: Translate, lang: Language): string {
  if (answer.best) return t('problem.best')
  const category = t(CATEGORY_LABEL[answer.category])
  return answer.loss > ZERO_LOSS ? t('problem.verdict', { category, loss: formatPoints(answer.loss, lang) }) : category
}
