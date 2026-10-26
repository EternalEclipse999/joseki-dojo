import type { Color } from '@joseki-dojo/shared'
import { pick, type Rng } from '../bot/rng'
import type { GraphBook } from '../graph/book'
import { fromNodeMove, pathMoves, pathToMove, zoneKey, type ZoneMove } from '../graph/key'
import type { Flow } from '../progress/compute'
import type { HabitShares } from './habits'

/** A path of the graph: nodes[0] = the list position X, nodes.at(-1) = the target; edges[i] (global) leads from nodes[i] to nodes[i + 1]. */
export interface GraphPath {
  nodes: number[]
  edges: number[]
}

/**
 * Part 3 spec 5.2: the need mass under each node — the sum over the move cards t under it, its own included, of the
 * probability of reaching t from it along `flow` times t's need. One pass backwards over the topological order.
 */
function needMass(graph: GraphBook, flow: Flow, moveNeed: Float64Array): Float64Array {
  const { player, share, to } = flow
  const order = graph.topoOrder()
  const mass = new Float64Array(graph.nodeCount)
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]
    let m = player[node] ? moveNeed[node] : 0
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) m += share[e] * mass[to[e]]
    mass[node] = m
  }
  return mass
}

/** By list node in node order: its reach times the need mass under it; several list ids on one node are one entry. */
function weightsOf(graph: GraphBook, reach: Float64Array, mass: Float64Array): Map<number, number> {
  const weights = new Map<number, number>()
  for (let node = 0; node < graph.nodeCount; node++) if (graph.nodeListIds(node).length > 0) weights.set(node, reach[node] * mass[node])
  return weights
}

/**
 * One step of a descent at `node`, one draw of `rng`: stopping there (-1) with the weight `stay`, or an edge that carries the
 * weight on (to[e] >= 0) with the weight share × `below` of its node.
 */
function step(graph: GraphBook, flow: Flow, node: number, stay: number, below: Float64Array, rng: Rng): number {
  const { share, to } = flow
  const options = [-1]
  for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) options.push(e)
  return pick(options, (e) => (e < 0 ? stay : share[e] * below[to[e]]), rng)
}

/**
 * Part 3 spec 5.2 «Случайно»: the list position X ∝ its reach from the empty corner (`reach`, reachOf of `flow`) times the
 * need mass under it (weightsOf), then a descent from X: at each node it stops ∝ the move need of a node of the player
 * (`moveNeed`) or goes on along an edge ∝ its share times the need mass under it, so the target t is drawn from X ∝ the
 * probability of reaching it from X times its need. `flow` is the part-2 flow at the player's level (progressFlow, without
 * habits). One draw of `rng` for X, then one at each node of the descent. Null when no list position reaches a move card
 * with need above 0.
 */
export function randomTarget(graph: GraphBook, flow: Flow, reach: Float64Array, moveNeed: Float64Array, rng: Rng): GraphPath | null {
  const mass = needMass(graph, flow, moveNeed)
  const weights = [...weightsOf(graph, reach, mass)]
  if (!weights.some(([, w]) => w > 0)) return null
  const [x] = pick(weights, ([, w]) => w, rng)
  const path: GraphPath = { nodes: [x], edges: [] }
  for (let node = x; ; ) {
    const e = step(graph, flow, node, flow.player[node] ? moveNeed[node] : 0, mass, rng)
    if (e < 0) return path
    node = flow.to[e]
    path.edges.push(e)
    path.nodes.push(node)
  }
}

/**
 * Part 3 spec 5.2 queue: the descent from `from` to `target` along `flow` (the part-2 flow at the player's level), each edge
 * ∝ its share times the probability of reaching the target from its node; one draw of `rng` at each node before the
 * target. The target alone when it is `from`; null when it is not under `from`.
 */
export function pathTo(graph: GraphBook, flow: Flow, from: number, target: number, rng: Rng): GraphPath | null {
  const { share, to } = flow
  const order = graph.topoOrder()
  // The probability of reaching the target from each node, one pass backwards; the descent ends at the target.
  const toTarget = new Float64Array(graph.nodeCount)
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]
    if (node === target) {
      toTarget[node] = 1
      continue
    }
    let r = 0
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) r += share[e] * toTarget[to[e]]
    toTarget[node] = r
  }
  if (!(toTarget[from] > 0)) return null
  const path: GraphPath = { nodes: [from], edges: [] }
  for (let node = from; node !== target; ) {
    const e = step(graph, flow, node, 0, toTarget, rng)
    node = to[e]
    path.edges.push(e)
    path.nodes.push(node)
  }
  return path
}

/**
 * Part 3 spec 5.3: the index of the start on the path (0 = X) — the smallest j for which the product of q over the player's
 * nodes (colour `color`) from nodes[j] to the target, the target excluded, is at least ½. q at a node is the player's habit
 * share of the path's move there: the sum of the habit shares of the node's edges that lead where the path's edge does, as
 * a move and its mirror at a symmetric node are two edges to one node and the habits split between them.
 */
export function startIndex(graph: GraphBook, path: GraphPath, habits: HabitShares, color: Color): number {
  const { nodes, edges } = path
  let start = nodes.length - 1
  let product = 1
  for (let i = nodes.length - 2; i >= 0; i--) {
    const node = nodes[i]
    if (graph.nodeToMove(node) === color) {
      const shares = habits(node)
      const first = graph.firstEdge(node)
      const to = graph.edgeTarget(edges[i])
      let q = 0
      for (let k = 0; k < shares.length; k++) if (graph.edgeTarget(first + k) === to) q += shares[k]
      product *= q
      if (product < 0.5) break
    }
    start = i
  }
  return start
}

/**
 * Part 3 spec 5.3: the setup of a path's start, in top-right moves, colours from Black — X's representative path, then the
 * path's edges before `start`; a tenuki edge is 'tenuki'. An edge's move is in its node's orientation, so it is played
 * mirrored when the moves before it read as the mirror of the node's key. The vertices may be shared with the graph: never
 * change them.
 */
export function realMoves(graph: GraphBook, path: GraphPath, start: number): ZoneMove[] {
  const moves: ZoneMove[] = [...graph.nodePath(path.nodes[0])]
  for (let i = 0; i < start; i++) {
    const node = path.nodes[i]
    const { move } = graph.edges(node)[path.edges[i] - graph.firstEdge(node)]
    moves.push(fromNodeMove(move, 'TR', zoneKey(pathMoves(moves), pathToMove(moves)).mirrored))
  }
  return moves
}

/** Part 3 spec 5.5: the first list id (file order) of the deepest node with list ids among nodes[0..start]; X is always one. */
export function nameOnPath(graph: GraphBook, path: GraphPath, start: number): string {
  for (let i = start; i >= 0; i--) {
    const ids = graph.nodeListIds(path.nodes[i])
    if (ids.length > 0) return ids[0]
  }
  throw new RangeError('The path starts at no list position')
}
