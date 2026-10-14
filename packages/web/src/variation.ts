import { sameVertex } from './board-maps'
import { colorSign, nextColor, otherColor, Position, vertexToGtp, type Color, type Move, type MoveVertex, type PositionReview, type ServerMessage, type Vertex } from '@joseki-dojo/shared'

/** Variations spec 3: the variation replaces game move `fromTurn`; `step` moves of it are shown (1..moves.length); `originTurn` is the game move that was shown when it was started. */
export interface Variation {
  fromTurn: number
  /** The game move that was shown when the variation was started: leaving returns to it. */
  originTurn: number
  moves: Vertex[]
  step: number
}

export const startVariation = (fromTurn: number, first: Vertex, originTurn = fromTurn): Variation => ({ fromTurn, originTurn, moves: [first], step: 1 })

/** Variations spec 8: a board click at game move `turn` plays the move after it (the board shows the position after `turn`). */
export const startAfterTurn = (turn: number, first: Vertex): Variation => startVariation(turn + 1, first, turn)

/** Variations spec 8: leaving a variation shows the game move that was shown when it was started. */
export const exitTurn = (v: Variation): number => v.originTurn

/** A move after the shown part: the hidden tail is replaced. */
export function playInVariation(v: Variation, next: Vertex): Variation {
  const moves = [...v.moves.slice(0, v.step), next]
  return { ...v, moves, step: moves.length }
}

/** Steps inside the variation, between its first move and its last. */
export const stepVariation = (v: Variation, delta: number): Variation => ({ ...v, step: Math.min(v.moves.length, Math.max(1, v.step + delta)) })

export const shownMoves = (v: Variation): Vertex[] => v.moves.slice(0, v.step)

/** The key of a position: the replaced game move and the variation moves before it (as sent to the server). */
export const positionKey = (fromTurn: number, moves: readonly Vertex[]): string => `${fromTurn}:${moves.map(vertexToGtp).join(' ')}`

/** The moves of the position after `moves` played from the position before game move `fromTurn`, colours alternating. */
export function variationMoves(before: readonly Move[], moves: readonly Vertex[]): Move[] {
  const out = [...before]
  let color = nextColor(out)
  for (const vertex of moves) {
    out.push({ color, vertex })
    color = otherColor(color)
  }
  return out
}

/** Whether `vertex` is a legal next move after `moves`. */
export function isLegalNext(moves: readonly Move[], vertex: Vertex): boolean {
  try {
    return Position.fromMoves(moves).isLegal(nextColor(moves), vertex)
  } catch {
    return false
  }
}

export type VariationUpdate = Extract<ServerMessage, { type: 'variationAnalysis' }>

/** The latest analysis of a position from the deepening search (spec 4). */
export interface VariationResult {
  visits: number
  /** The search reached the visits limit: nothing more will come for this position. */
  done: boolean
  position: PositionReview
}

/** Spec 4: a message replaces a stored result only with more visits, or marks it done; an unchanged map is returned as is. */
export function mergeResult(results: ReadonlyMap<string, VariationResult>, msg: VariationUpdate): ReadonlyMap<string, VariationResult> {
  const key = positionKey(msg.fromTurn, msg.moves)
  const known = results.get(key)
  let next: VariationResult
  if (!known || msg.visits > known.visits) next = { visits: msg.visits, done: msg.done, position: msg.position }
  else if (msg.done && !known.done) next = { ...known, done: true }
  else return results
  return new Map(results).set(key, next)
}

/**
 * Spec 5: KataGo replies as soon as the awaited position rests on `replyVisits` (the review's visits; unknown: wait
 * for the end of the search), or when its search is done.
 */
export const shouldReply = (result: VariationResult | undefined, replyVisits: number | null): boolean =>
  result !== undefined && (result.done || (replyVisits !== null && result.visits >= replyVisits))

/** The index of the candidate at `vertex`; 0 (the best one) when none is chosen or it is not in the list any more. */
export function candidateIndex(candidates: readonly { vertex: MoveVertex }[], vertex: MoveVertex | null): number {
  if (vertex === null) return 0
  const i = candidates.findIndex((c) => sameVertex(c.vertex, vertex))
  return i < 0 ? 0 : i
}

/** Whether a chosen candidate has left the list (a deeper analysis may drop it). */
export const candidateLeft = (candidates: readonly { vertex: MoveVertex }[], vertex: MoveVertex | null): boolean =>
  vertex !== null && !candidates.some((c) => sameVertex(c.vertex, vertex))

/** Spec 5: KataGo's reply is the best candidate of the result; none without a result or when the best move is a pass. */
/** The best move of the result is a pass: KataGo has nothing to play. */
export const bestIsPass = (result: VariationResult | undefined): boolean => result?.position.candidates[0]?.vertex === 'pass'

export function replyVertex(result: VariationResult | undefined): Vertex | null {
  const best = result?.position.candidates[0]?.vertex
  return best && best !== 'pass' ? best : null
}

/** Spec 3: what a move by `mover` lost, from Black's score lead before and after it; a gain counts as no loss. */
export const moveLoss = (mover: Color, leadBefore: number, leadAfter: number): number => Math.max(0, colorSign(mover) * (leadBefore - leadAfter))
