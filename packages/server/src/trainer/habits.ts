import type { Color } from '@joseki-dojo/shared'
import type { GraphBook, LevelArrays } from '../graph/book'
import { sameZoneMove } from '../graph/key'
import type { GraphReview, MoveRaw } from '../progress/repo'

/**
 * Part 3 spec 4: per node of the colour, the count of each of its good edges the player chose (aligned with its edges).
 * A move card review of `color` counts its move when the move is a good edge (GraphBook.goodEdge: ideal or good in either
 * dictionary, as the progress has it) of the card's node. A mistake, a move off the edges, a review older than the moves
 * kept (no `move`), a rest review and a card whose key is no node of the graph count nothing; a node with nothing counted
 * has no entry.
 */
export function habitCounts(graph: GraphBook, reviews: readonly GraphReview[], color: Color): Map<number, Float64Array> {
  const counts = new Map<number, Float64Array>()
  for (const r of reviews) {
    if (r.kind !== 'move' || r.color !== color) continue
    const { move } = r.raw as MoveRaw
    if (move === undefined) continue
    const node = graph.node(r.cardKey)
    if (node === null) continue
    const first = graph.firstEdge(node)
    const k = graph.edges(node).findIndex((e) => sameZoneMove(e.move, move))
    if (k < 0 || !graph.goodEdge(first + k)) continue
    let chosen = counts.get(node)
    if (!chosen) counts.set(node, (chosen = new Float64Array(graph.firstEdge(node + 1) - first)))
    chosen[k]++
  }
  return counts
}

/** The shares of a node's good edges, aligned with its edges (0 for the others); all 0 without a good edge. */
export type HabitShares = (node: number) => Float64Array

/**
 * Part 3 spec 4: the player's habit at a node — the shares of the moves counted there (habitCounts); without one, the
 * probabilities of the node's good edges at `level` (the player's) normalised among them, equal shares when the level
 * gives them none at all, as the progress does (part 2 spec 4.2). A node's shares are computed when first asked for and
 * kept; they are shared, so never change them.
 */
export function habitShares(graph: GraphBook, counts: ReadonlyMap<number, Float64Array>, level: LevelArrays): HabitShares {
  const kept = new Map<number, Float64Array>()
  return (node) => {
    let shares = kept.get(node)
    if (shares) return shares
    const first = graph.firstEdge(node)
    const n = graph.firstEdge(node + 1) - first
    shares = new Float64Array(n)
    const chosen = counts.get(node)
    let total = 0
    if (chosen) for (let k = 0; k < n; k++) total += chosen[k]
    if (chosen && total > 0) {
      for (let k = 0; k < n; k++) shares[k] = chosen[k] / total
    } else {
      let sum = 0
      let good = 0
      for (let e = first; e < first + n; e++) {
        if (!graph.goodEdge(e)) continue
        sum += level.edge[e]
        good++
      }
      for (let e = first; e < first + n; e++) if (graph.goodEdge(e)) shares[e - first] = sum > 0 ? level.edge[e] / sum : 1 / good
    }
    kept.set(node, shares)
    return shares
  }
}
