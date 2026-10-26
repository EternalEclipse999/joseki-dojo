import { inZone, type Corner, type MoveVertex } from '@joseki-dojo/shared'
import type { NaturalMove } from '../bot/choose'
import { pick, type Rng } from '../bot/rng'
import type { GraphBook } from '../graph/book'
import { sameZoneMove, toNodeMove, type ZoneMove } from '../graph/key'

export interface LeaveInput {
  graph: GraphBook
  /** The node of the position the bot moves from, and whether the training sees it mirrored (GraphBook.nodeOfTraining). */
  node: number
  mirrored: boolean
  /** The training's corner. */
  corner: Corner
}

/**
 * Part 3 spec 5.4: the bot's move at a rest target — one of its natural moves that is no edge of the node, ∝ its natural
 * probability (one draw of `rng`); null, without a draw, when every natural move the bot may play (p above 0: the tenuki
 * is listed with 0 where the bot never leaves) is an edge's. A natural move is the edge's with its move in the node's
 * orientation; a move outside the corner, a pass included, is the tenuki edge's, as the training's walk has it, and
 * leaves the graph at a node without one.
 */
export function leaveMove(natural: readonly NaturalMove[], at: LeaveInput, rng: Rng): MoveVertex | null {
  const { graph, node, mirrored, corner } = at
  const edges = graph.edges(node)
  const off = natural.filter((m) => {
    if (!(m.p > 0)) return false
    const move: ZoneMove = m.vertex !== 'pass' && inZone(corner, m.vertex) ? toNodeMove(m.vertex, corner, mirrored) : 'tenuki'
    return !edges.some((e) => sameZoneMove(e.move, move))
  })
  return off.length > 0 ? pick(off, (m) => m.p, rng).vertex : null
}
