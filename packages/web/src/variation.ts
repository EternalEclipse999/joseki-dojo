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

/**
 * Problem variations 2.2: the first view — the start view (−1: the position before game move 0, no game move placed) on a
 * screen that has one, else game move 0.
 */
export const firstTurn = (startView: boolean): number => (startView ? -1 : 0)

/** Stepping through the game stops at the first view and at the last game move. */
export const stepTurn = (turn: number, delta: number, lastTurn: number, startView: boolean): number =>
  Math.min(lastTurn, Math.max(firstTurn(startView), turn + delta))

/** The game position whose candidates view `turn` shows: the one before game move `turn`; the start view's is game move 0's. */
export const positionTurn = (turn: number): number => Math.max(0, turn)

/** Variations spec 8, problem variations 2.2: a board click plays after the shown game move; on the start view, which shows none, instead of game move 0. */
export const startFromView = (turn: number, first: Vertex): Variation => (turn < 0 ? startVariation(0, first, turn) : startAfterTurn(turn, first))

/** A move after the shown part: the hidden tail is replaced. */
export function playInVariation(v: Variation, next: Vertex): Variation {
  const moves = [...v.moves.slice(0, v.step), next]
  return { ...v, moves, step: moves.length }
}

/** Steps inside the variation, between its first move and its last. */
export const stepVariation = (v: Variation, delta: number): Variation => ({ ...v, step: Math.min(v.moves.length, Math.max(1, v.step + delta)) })

export const shownMoves = (v: Variation): Vertex[] => v.moves.slice(0, v.step)

/** The move numbers a variation is shown with: `from`, its first move's («Вариант от хода N»); `move`, its shown move's («Ход N»). */
export interface VariationNumbers {
  from: number
  move: number
}

/** A variation's move numbers when game move 0 is move `firstNumber`: 1 in the review; a problem counts from its own move. */
export function variationNumbers(v: Variation, firstNumber = 1): VariationNumbers {
  const before = firstNumber - 1 + v.fromTurn
  return { from: before + 1, move: before + v.step }
}

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

/** What the variations take from an analysis message, whichever screen it belongs to (a review session or a problem card). */
export type VariationUpdateLike = Pick<VariationUpdate, 'fromTurn' | 'moves' | 'visits' | 'done' | 'position'>

/** The latest analysis of a position from the deepening search (spec 4). */
export interface VariationResult {
  visits: number
  /** The search reached the visits limit: nothing more will come for this position. */
  done: boolean
  position: PositionReview
}

/** Spec 4: a message replaces a stored result only with more visits, or marks it done; an unchanged map is returned as is. */
export function mergeResult(results: ReadonlyMap<string, VariationResult>, msg: VariationUpdateLike): ReadonlyMap<string, VariationResult> {
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

/**
 * Spec 3: the position the last variation move is measured from — the previous variation position's result, or, for the
 * first move, the stored position it replaces (its deeper result once that rests on more visits). A stored position may
 * hold only a lead (problem variations 2.3: the lead after the answer).
 */
export const lossBefore = (first: boolean, prev: VariationResult | undefined, stored: PositionReview): PositionReview | undefined =>
  !first ? prev?.position : prev && prev.visits > stored.visits ? prev.position : stored
