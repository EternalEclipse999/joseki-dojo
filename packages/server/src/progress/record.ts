import { inZone, otherColor, sameVertex, type Color, type Corner, type Move, type Rating, type ResolvedSettings, type ReviewData } from '@joseki-dojo/shared'
import type { Thresholds } from '../config'
import type { GraphBook } from '../graph/book'
import { sameZoneMove, toNodeMove, trainingKey, type ZoneMove } from '../graph/key'
import { categorize } from '../review/compute'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import type { MoveRaw, RestRaw } from './repo'

/** The graph card reviews a training gives, and the positions it met outside the graph. */
export interface TrainingWalk {
  /** The player's colour in the graph: a role, Black being the side that started the corner (see walkTraining). */
  color: Color
  moves: { key: string; raw: MoveRaw; auto: Rating }[]
  rest: { key: string; raw: RestRaw; auto: Rating } | null
  met: string[]
}

/** Spec 3.2: KataGo's best move → easy, exact → good, inaccuracy → hard, mistake or blunder → again. */
export function moveRating(raw: MoveRaw, th: Thresholds): Rating {
  if (raw.best) return 'easy'
  const category = categorize(raw.loss, th)
  return category === 'exact' ? 'good' : category === 'inaccuracy' ? 'hard' : 'again'
}

/**
 * Spec 3.3: the worst of the player's moves and of the opponent's unpunished mistakes (a move that lost at least the
 * `mistake` threshold, answered by a reply that lost at least the `punished` one) after leaving the graph: all exact →
 * good, an inaccuracy → hard, a mistake, a blunder or an unpunished mistake → again — or hard when every one of those was
 * made at a position the player met for the first time. The opponent's other moves count for nothing.
 */
export function restRating(raw: RestRaw, th: Thresholds): Rating {
  const errors: boolean[] = [] // seenBefore of each mistake, blunder and unpunished mistake
  let inaccuracy = false
  for (const m of raw.moves) {
    const category = categorize(m.loss, th)
    if (category === 'inaccuracy') inaccuracy = true
    else if (category !== 'exact') errors.push(m.seenBefore)
  }
  for (const o of raw.opponent) if (o.loss >= th.mistake && o.replyLoss >= th.punished) errors.push(o.seenBefore)
  if (errors.length > 0) return errors.some((seen) => seen) ? 'again' : 'hard'
  return inaccuracy ? 'hard' : 'good'
}

/**
 * Spec 3.3: whether a rest card's raw data make a review at `th` — a move of the player in the zone after leaving the
 * graph, or a mistake of the opponent there. A level-change replay skips a review that makes none at the new level.
 */
export const restReviewed = (raw: RestRaw, th: Thresholds): boolean => raw.moves.length > 0 || raw.opponent.some((o) => o.loss >= th.mistake)

export interface WalkStep {
  node: number
  mirrored: boolean
  /** the move played there, in the node's orientation */
  move: ZoneMove
}

/**
 * Part 2 spec 3.1: `moves` (Black first: the colours are roles) walked from the empty corner. `steps[i]` is the node before
 * move i; `exit` the index of the move that left the graph (null while in it); `at` the node after the last move, null once left.
 *
 * A move outside the zone of `corner` (a pass included) is a tenuki. The walk leaves the graph at a node on a move that is
 * not among its edges, on an edge without a node, or on a back edge (GraphBook.backEdge: the edge that cuts a cycle of the
 * graph, a tenuki two-cycle or a ko, spec 4.2 — the progress sends the weight of the same edges to the rest card), and
 * stops there: the last step is the leaving move's. Before any move it is at the empty corner; without a graph, nowhere.
 */
export function graphWalk(moves: readonly Move[], corner: Corner, graph: GraphBook): { steps: WalkStep[]; exit: number | null; at: { node: number; mirrored: boolean } | null } {
  const steps: WalkStep[] = []
  let at = graph.nodeOfTraining([], corner, 'B')
  const walked = new Set<number>()
  for (let i = 0; at && i < moves.length; i++) {
    walked.add(at.node)
    const { color, vertex } = moves[i]
    // The orientation is read again at every node: it can flip along an edge.
    const move = toNodeMove(vertex !== 'pass' && inZone(corner, vertex) ? vertex : 'tenuki', corner, at.mirrored)
    steps.push({ node: at.node, mirrored: at.mirrored, move })
    const edges = graph.edges(at.node)
    const k = edges.findIndex((e) => sameZoneMove(e.move, move))
    const along = k >= 0 && edges[k].to !== null && !graph.backEdge(graph.firstEdge(at.node) + k)
    const next = along ? graph.nodeOfTraining(moves.slice(0, i + 1), corner, otherColor(color)) : null
    // A guard only: the graph without its back edges has no cycle, so the walk cannot meet a node twice; should it ever (a
    // node found by key that is not the edge's target), it leaves the graph there instead of going round.
    if (!next || walked.has(next.node)) return { steps, exit: i, at: null }
    at = next
  }
  return { steps, exit: null, at }
}

/**
 * Spec 2.3: the number of initial moves a training's origin puts on the board — its trap's setup, its start's moves (a deep
 * start's setup, part 3 spec 5.3), none for a free game; null for a start the book no longer knows (a replay of it cannot be
 * told apart).
 */
export function originLength(settings: ResolvedSettings, starts: StartBook): number | null {
  const { trap, start, corner } = settings
  if (trap) return trap.index
  if (!start) return 0
  if (start.graph) return start.graph.setup
  if (!starts.canPlace(start.id)) return null
  return starts.place(start.id, corner, start.mirror, start.swapColors).length
}

/**
 * Spec 3.1–3.3: the reviews a training gives, as pure data (no storage). `origin` is the number of initial moves its
 * origin puts on the board (originLength: the start's moves, the trap's setup, 0 for a free game): a training with more
 * is a replay from move N and gives nothing (spec 2.3). `seen` tells whether a position was met outside the graph in an
 * earlier training.
 *
 * The graph's colours are roles: Black is the side that started the corner. A training whose first move is White's (a
 * trap where the user has the trick's colour, a dubious start with swapped colours) is walked with the colours inverted,
 * so it reaches the same nodes as the same moves started by Black, and it is recorded under the inverted player colour
 * (`color`); the keys of the positions it meets after leaving the graph are inverted too.
 *
 * The moves, the initial ones first, are walked through the graph from the empty corner (graphWalk) to the move that
 * leaves it. Every node of the walk where the player played a move of the training gets a move card review, which keeps
 * the move in the node's orientation (part 3 spec 4). The node it left at gets a rest card review for the player's
 * colour, whose raw data keeps everything a rating at another level needs: every in-zone move of the player after the
 * leaving move, and every in-zone move of the opponent from the leaving move on that the player answered, mistake or not.
 * There is no rest review when the player made no in-zone move after the leaving move and the opponent made no mistake at
 * the recording level. `met` lists the player's decision positions after the leaving move: the position before each move
 * of the player in the training, the player to move.
 */
export function walkTraining(rec: SessionRecord, review: ReviewData, graph: GraphBook, seen: (key: string) => boolean, thresholds: Thresholds, origin: number): TrainingWalk {
  const { corner, userColor } = rec.settings
  const played: Move[] = [...rec.initialMoves, ...rec.moves.map(({ color, vertex }) => ({ color, vertex }))]
  const swapped = played.length > 0 && played[0].color === 'W'
  const role = (c: Color): Color => (swapped ? otherColor(c) : c)
  const player = role(userColor)
  const nothing: TrainingWalk = { color: player, moves: [], rest: null, met: [] }
  if (rec.initialMoves.length !== origin) return nothing
  // In roles, every training starts with Black at the empty corner.
  const all: Move[] = played.map(({ color, vertex }) => ({ color: role(color), vertex }))
  const start = rec.initialMoves.length
  const { steps, exit } = graphWalk(all, corner, graph)
  const moves: TrainingWalk['moves'] = []
  // Spec 3.2: the start moves (before turn 0) were not the player's choice; the move that left the graph is reviewed too.
  for (let i = start; i < steps.length; i++) {
    if (all[i].color !== player) continue
    const turn = i - start
    const best = review.positions[turn]?.candidates[0]?.vertex
    const raw: MoveRaw = { loss: review.moveReviews[turn].loss, best: best !== undefined && sameVertex(all[i].vertex, best), move: steps[i].move }
    moves.push({ key: graph.nodeKey(steps[i].node), raw, auto: moveRating(raw, thresholds) })
  }
  if (exit === null) return { ...nothing, moves }

  const losses = review.moveReviews.map((m) => m.loss)
  const raw: RestRaw = { moves: [], opponent: [] }
  const met = new Set<string>()
  // The player's decision positions after the leaving move (whose own review, when it is the player's, is its move card's).
  for (let i = Math.max(exit + 1, start); i < all.length; i++) {
    if (all[i].color !== player) continue
    const turn = i - start
    const key = trainingKey(all.slice(0, i), corner, player).key
    const seenBefore = met.has(key) || seen(key)
    met.add(key)
    if (rec.moves[turn].inZone) raw.moves.push({ loss: losses[turn], key, seenBefore })
    // Spec 3.3: an opponent's move is judged at the position after it, where the player has to answer (punish) it.
    const previous = rec.moves[turn - 1]
    if (i - 1 >= exit && previous && all[i - 1].color !== player && previous.inZone) {
      raw.opponent.push({ loss: losses[turn - 1], replyLoss: losses[turn], key, seenBefore })
    }
  }
  const rest = restReviewed(raw, thresholds) ? { key: graph.nodeKey(steps[exit].node), raw, auto: restRating(raw, thresholds) } : null
  return { color: player, moves, rest, met: [...met] }
}
