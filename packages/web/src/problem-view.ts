import type { Marker } from '@sabaki/shudan'
import type { Language, Move, MoveVertex, ProblemAnswer, ProblemView, Translate, Vertex } from '@joseki-dojo/shared'
import { isVertex, sameVertex } from './board-maps'
import { CATEGORY_LABEL, formatPoints, ZERO_LOSS } from './format'

/** A mark of the problem board. */
export interface ProblemMark {
  vertex: Vertex
  marker: Marker
}

/**
 * Repetition spec 5.4: the marks of the problem board, at most one per point. Before the answer the last setup move;
 * after it the answer (circle), KataGo's best move when it is another point (triangle) and, for the player's own
 * mistake, the move played in the training (cross): the answer's circle wins when the same move is played again. While
 * KataGo's line is shown (`line`), its moves are numbered instead. A pass has no point and no mark.
 */
export function problemMarks(problem: ProblemView, answer: ProblemAnswer | null, line: readonly Move[] | null): ProblemMark[] {
  const marks = new Map<string, ProblemMark>()
  const mark = (v: MoveVertex, marker: Marker): void => {
    if (isVertex(v)) marks.set(`${v[0]},${v[1]}`, { vertex: v, marker })
  }
  if (line) line.forEach((m, i) => mark(m.vertex, { type: 'label', label: String(i + 1) }))
  else if (answer) {
    if (problem.source === 'mistake') mark(problem.userMove, { type: 'cross' })
    if (!sameVertex(answer.line.vertex, answer.vertex)) mark(answer.line.vertex, { type: 'triangle' })
    mark(answer.vertex, { type: 'circle' })
  } else {
    const last = problem.moves.at(-1)
    if (last) mark(last.vertex, { type: 'point' })
  }
  return [...marks.values()]
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
