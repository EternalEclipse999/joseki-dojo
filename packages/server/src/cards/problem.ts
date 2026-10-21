import { colorSign, Position, vertexToGtp, zoneVertices, type Color, type Corner, type Move, type MoveVertex, type ProblemCandidate, type ProblemSource, type ReviewData, type StartGroup, type Vertex } from '@joseki-dojo/shared'
import { mirrorDiagonal, movesToTopRight } from '../jdb'
import { movesBefore, type SessionRecord } from '../store/records'

/** Spec (repetition) 4.2: everything a problem card needs, independent of the training it came from. */
export interface ProblemData {
  source: ProblemSource
  corner: Corner
  userColor: Color
  toMove: Color
  moves: Move[]
  userMove: MoveVertex
  userLoss: number
  moveNumber: number
  group: StartGroup | null
  /** The review's analysis of the problem position (Black's lead, its visits, the candidates with their losses). */
  analysis: { scoreLeadBlack: number; visits: number; candidates: ProblemCandidate[] }
}

const isVertex = (v: MoveVertex): v is Vertex => v !== 'pass'

/** Spec (repetition) 4.1: the position seen in the top-right corner, diagonal-canonical, with the colour to move. */
export function problemKey(moves: readonly Move[], corner: Corner, toMove: Color): string {
  const s = Position.fromMoves(movesToTopRight(moves, corner)).signMap()
  const read = (mirror: boolean): string => {
    let out = ''
    for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
      const [mx, my] = mirror ? mirrorDiagonal([x, y]) : [x, y]
      out += String(s[my][mx] + 1)
    }
    return out
  }
  const plain = read(false)
  const mirrored = read(true)
  return `move:${toMove}:${plain <= mirrored ? plain : mirrored}`
}

const GROUPS: Record<string, StartGroup> = { '4-4': '4-4', '3-4': '3-4', '4-3': '3-4', '3-3': '3-3', '4-5': '5-4', '5-4': '5-4', '3-5': '5-3', '5-3': '5-3' }

/** The group of the corner by its first stone (lines counted from the corner's edges); null for another point. */
export function cornerGroup(moves: readonly Move[], corner: Corner): StartGroup | null {
  const first = movesToTopRight(moves, corner).find((m) => isVertex(m.vertex))
  if (!first || !isVertex(first.vertex)) return null
  const fromRight = 19 - first.vertex[0]
  const fromTop = first.vertex[1] + 1
  return GROUPS[`${fromRight}-${fromTop}`] ?? null
}

/** The stones of the corner zone seen in the top-right corner (captures applied), as GTP — for the small board. */
export function zoneStones(moves: readonly Move[], corner: Corner): { black: string[]; white: string[] } {
  const s = Position.fromMoves(movesToTopRight(moves, corner)).signMap()
  const black: string[] = []
  const white: string[] = []
  for (const [x, y] of zoneVertices('TR')) {
    if (s[y][x] === 1) black.push(vertexToGtp([x, y]))
    else if (s[y][x] === -1) white.push(vertexToGtp([x, y]))
  }
  return { black, white }
}

/** Spec (repetition) 4.2: the problems of a computed review — in-zone user mistakes and unpunished in-zone bot mistakes. */
export function findProblems(rec: SessionRecord, review: ReviewData): ProblemData[] {
  const byTurn = new Map<number, ProblemSource>()
  for (const m of review.moveReviews) {
    if (m.actor === 'user' && review.moves[m.turn]?.inZone && (m.category === 'mistake' || m.category === 'blunder')) byTurn.set(m.turn, 'mistake')
  }
  for (const p of review.punishments) {
    if (!p.punished && review.moves[p.turn]?.inZone && review.moves[p.turn + 1]) byTurn.set(p.turn + 1, 'unpunished')
  }
  const out: ProblemData[] = []
  for (const [turn, source] of [...byTurn].sort((a, b) => a[0] - b[0])) {
    const played = review.moves[turn]
    const position = review.positions[turn]
    // A position without candidates has no best move to show or judge by.
    if (!played || !position || position.candidates.length === 0) continue
    const moves = movesBefore(rec, turn)
    out.push({
      source,
      corner: rec.settings.corner,
      userColor: rec.settings.userColor,
      toMove: played.color,
      moves,
      userMove: played.vertex,
      userLoss: review.moveReviews[turn]?.loss ?? 0,
      moveNumber: rec.initialMoves.length + turn + 1,
      group: cornerGroup(moves, rec.settings.corner),
      analysis: { scoreLeadBlack: position.scoreLeadBlack, visits: position.visits, candidates: position.candidates.map((c) => ({ vertex: c.vertex, loss: c.loss, pv: c.pv })) },
    })
  }
  return out
}

/** Spec (repetition) 5.4: the loss of `vertex` judged from the stored candidates; null when it is not among them. */
export function candidateLoss(data: ProblemData, vertex: Vertex): { loss: number; best: boolean } | null {
  const i = data.analysis.candidates.findIndex((c) => c.vertex !== 'pass' && c.vertex[0] === vertex[0] && c.vertex[1] === vertex[1])
  return i < 0 ? null : { loss: data.analysis.candidates[i].loss, best: i === 0 }
}

/** Spec (repetition) 5.4: the loss of a move from the lead after it (Black's view), as the review computes it. */
export const lossAfter = (data: ProblemData, afterLeadBlack: number): number => Math.max(0, colorSign(data.toMove) * (data.analysis.scoreLeadBlack - afterLeadBlack))
