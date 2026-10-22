import { writeFileSync } from 'node:fs'
import { gtpToVertex, type Vertex } from '@joseki-dojo/shared'
import { mirrorDiagonal, zoneVertex } from '../jdb'
import { encodeGraph, encodeWeights, type EdgeCategory, type GraphEdge, type GraphNode, type GraphWeights, type JosekiGraph } from './format'
import { pathMoves, pathToMove, ZONE_POINTS, zoneKey, type ZoneMove } from './key'

const v = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex
const node = (path: ZoneMove[], listIds: string[] = []): GraphNode => ({ key: zoneKey(pathMoves(path), pathToMove(path)).key, toMove: pathToMove(path), path, listIds })
export const TEST_LIST_ID = 'list-q16'

/**
 * A small joseki graph:
 *   0  the empty corner
 *   1  Q16 (on the list as TEST_LIST_ID)
 *   2  Q16 O17 — kept as its mirror Q16 R14, the smaller reading; both White moves from node 1 lead to it
 * Node 1 also has an unexpanded R17 of the second dictionary, node 2 an unexpanded tenuki of the first.
 */
export function testGraph(): JosekiGraph {
  const edges: GraphEdge[] = [
    { from: 0, to: 1, move: v('Q16'), categories: [{ source: 0, category: 'ideal' }, { source: 1, category: 'ideal' }] },
    { from: 1, to: 2, move: v('O17'), categories: [{ source: 0, category: 'good' }, { source: 1, category: 'ideal' }] },
    { from: 1, to: 2, move: v('R14'), categories: [{ source: 0, category: 'good' }] },
    { from: 1, to: null, move: v('R17'), categories: [{ source: 1, category: 'trick' }] },
    { from: 2, to: null, move: 'tenuki', categories: [{ source: 0, category: 'question' }] },
  ]
  return { nodes: [node([]), node([v('Q16')], [TEST_LIST_ID]), node([v('Q16'), v('R14')])], edges }
}

/**
 * A graph to walk trainings through (progress part 2, spec 3.1), in top-right moves from the empty corner:
 *   0  the empty corner: Black Q16 (node 1), Black R14 (node 6), a Black tenuki (node 8)
 *   1  Q16: White R14 and its mirror O17 lead to node 2, White R17 is unexpanded, a White tenuki leads to node 3
 *   2  Q16 R14, then Black O16 (node 4)
 *   3  Q16 tenuki: a Black tenuki returns to node 1 (a tenuki two-cycle), Black R14 leads to node 5
 *   4  Q16 R14 O16, with an unexpanded White tenuki
 *   5  Q16 tenuki R14 (Black Q16 and R14, White to move), with an unexpanded White tenuki
 *   6  R14, then a White tenuki (node 7)
 *   7  R14 tenuki: Black Q16 leads to node 5 (a transposition of Q16 tenuki R14)
 *   8  tenuki: the empty corner with White to move (as in the real graph), then White Q16 (node 9)
 *   9  tenuki Q16 (a White Q16, Black to move), without edges
 */
export function walkGraph(): JosekiGraph {
  const edge = (line: string[], move: string, expanded = true): LineEdge => ({ line, move, expanded })
  return lineGraph([
    edge([], 'Q16'),
    edge(['Q16'], 'R14'),
    edge(['Q16'], 'O17'),
    edge(['Q16'], 'R17', false),
    edge(['Q16'], 'tenuki'),
    edge(['Q16', 'R14'], 'O16'),
    edge(['Q16', 'R14', 'O16'], 'tenuki', false),
    edge(['Q16', 'tenuki'], 'tenuki'),
    edge(['Q16', 'tenuki'], 'R14'),
    edge(['Q16', 'tenuki', 'R14'], 'tenuki', false),
    edge([], 'R14'),
    edge(['R14'], 'tenuki'),
    edge(['R14', 'tenuki'], 'Q16'),
    edge([], 'tenuki'),
    edge(['tenuki'], 'Q16'),
  ]).graph
}

/** The list id of cycleGraph(), on Q16 R14. */
export const CYCLE_LIST_ID = 'cycle'

/**
 * A tenuki two-cycle entered at both of its nodes (progress part 2, spec 4.2), in top-right moves from the empty corner:
 *   0  the empty corner, then Black Q16 (node 1) and White R14 (node 2)
 *   2  Q16 R14 (on the list as CYCLE_LIST_ID): a Black tenuki (node 3), given first, and Black O16 (node 4)
 *   3  Q16 R14 tenuki, then White R12 (node 5)
 *   5  Q16 R14 tenuki R12, then Black O16 to node 6
 *   4  Q16 R14 O16, then White R12 to node 7
 *   7  X = Q16 R14 O16 R12, Black to move, 4 moves deep: a Black tenuki to node 6
 *   6  Y = X's stones with White to move, 5 moves deep: a White tenuki back to X
 * A walk from the empty corner along the edges in their order reaches Y first (through Black's tenuki at Q16 R14), so it
 * would cut X → Y; the shallowest-node rule cuts Y → X.
 */
export function cycleGraph(): JosekiGraph {
  const edge = (line: string[], move: string): LineEdge => ({ line, move })
  return lineGraph(
    [
      edge([], 'Q16'),
      edge(['Q16'], 'R14'),
      edge(['Q16', 'R14'], 'tenuki'),
      edge(['Q16', 'R14'], 'O16'),
      edge(['Q16', 'R14', 'tenuki'], 'R12'),
      edge(['Q16', 'R14', 'tenuki', 'R12'], 'O16'),
      edge(['Q16', 'R14', 'O16'], 'R12'),
      edge(['Q16', 'R14', 'O16', 'R12'], 'tenuki'),
      edge(['Q16', 'R14', 'O16', 'R12', 'tenuki'], 'tenuki'),
    ],
    { [CYCLE_LIST_ID]: ['Q16', 'R14'] },
  ).graph
}

/** An edge for lineGraph: `move` (a top-right point in GTP, or 'tenuki') played after `line`, the moves from the empty corner. */
export interface LineEdge {
  line: string[]
  move: string
  /** false: no node after the move (`to: null`); default true. */
  expanded?: boolean
  /** The edge's category in the first dictionary; default 'ideal'. */
  category?: EdgeCategory
}

const zoneMove = (m: string): ZoneMove => (m === 'tenuki' ? m : v(m))
const mirrorMove = (m: ZoneMove): ZoneMove => (m === 'tenuki' ? m : mirrorDiagonal(m))

/** The key of the position after `line` (top-right moves from the empty corner, in GTP or 'tenuki'). */
export function lineKey(line: string[]): string {
  const path = line.map(zoneMove)
  return zoneKey(pathMoves(path), pathToMove(path)).key
}

/**
 * A graph of edges given by their lines (top-right moves from the empty corner): node 0 is the empty corner, and every other
 * position becomes a node when an edge first reaches it (lines that reach one position reach one node), its path and the
 * moves of its edges turned into the orientation of its key. `lists` puts each list id on the node of its line. The edges
 * are grouped by node in node order, each node's in the order given; `edges` are the specs in that order.
 */
export function lineGraph<T extends LineEdge>(specs: readonly T[], lists: Readonly<Record<string, string[]>> = {}): { graph: JosekiGraph; edges: T[] } {
  const nodes: GraphNode[] = []
  const byKey = new Map<string, number>()
  const nodeOf = (path: ZoneMove[]): number => {
    const { key, mirrored } = zoneKey(pathMoves(path), pathToMove(path))
    let i = byKey.get(key)
    if (i === undefined) {
      byKey.set(key, (i = nodes.length))
      nodes.push(node(mirrored ? path.map(mirrorMove) : path))
    }
    return i
  }
  nodeOf([])
  const built = specs.map((spec) => {
    const path = spec.line.map(zoneMove)
    const { mirrored } = zoneKey(pathMoves(path), pathToMove(path))
    const move = zoneMove(spec.move)
    const from = nodeOf(path)
    const to = spec.expanded === false ? null : nodeOf([...path, move])
    const edge: GraphEdge = { from, to, move: mirrored ? mirrorMove(move) : move, categories: [{ source: 0, category: spec.category ?? 'ideal' }] }
    return { spec, edge }
  })
  for (const [id, line] of Object.entries(lists)) nodes[nodeOf(line.map(zoneMove))].listIds.push(id)
  // The file groups the edges by node in node order (a stable sort keeps each node's edges in the order given).
  built.sort((a, b) => a.edge.from - b.edge.from)
  return { graph: { nodes, edges: built.map((b) => b.edge) }, edges: built.map((b) => b.spec) }
}

/** Weights of testGraph() for two levels. */
export function testWeights(): GraphWeights {
  return {
    levels: ['5k', '1d'],
    edge: [Float32Array.from([0.4, 0.3, 0.2, 0.05, 0.25]), Float32Array.from([0.6, 0.123456, 0.333333, 0.5, 1])],
    rest: [Float32Array.from([0.6, 0.45, 0.75]), Float32Array.from([0.4, 0.043211, 0])],
  }
}

const CATEGORIES: EdgeCategory[] = ['ideal', 'good', 'bad', 'trick', 'question']

/**
 * A larger graph for the key index: the empty corner; every first Black move in the zone (a move and its mirror lead to
 * one node); under the first `answered` of those nodes a tenuki that leaves the graph and every White answer in the zone.
 * List ids: 'wide-5' on node 5, 'wide-7a' and 'wide-7b' on node 7.
 */
export function wideGraph(answered = 12): JosekiGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const byKey = new Map<string, number>()
  // The node of a position (top-right coordinates), added with its path turned into the orientation of its key.
  const nodeOf = (path: ZoneMove[]): number => {
    const { key, mirrored } = zoneKey(pathMoves(path), pathToMove(path))
    let i = byKey.get(key)
    if (i === undefined) {
      byKey.set(key, (i = nodes.length))
      nodes.push(node(mirrored ? path.map((m) => (m === 'tenuki' ? m : mirrorDiagonal(m))) : path))
    }
    return i
  }
  const edge = (from: number, move: ZoneMove, to: number | null): void => {
    const k = edges.length
    edges.push({ from, to, move, categories: [{ source: (k % 2) as 0 | 1, category: CATEGORIES[k % CATEGORIES.length] }] })
  }
  nodeOf([])
  for (let p = 0; p < ZONE_POINTS; p++) edge(0, zoneVertex(p), nodeOf([zoneVertex(p)]))
  for (let from = 1; from <= answered; from++) {
    const path = nodes[from].path
    edge(from, 'tenuki', null)
    for (let p = 0; p < ZONE_POINTS; p++) {
      const move = zoneVertex(p)
      if (path.some((m) => m !== 'tenuki' && m[0] === move[0] && m[1] === move[1])) continue
      edge(from, move, nodeOf([...path, move]))
    }
  }
  nodes[5].listIds.push('wide-5')
  nodes[7].listIds.push('wide-7a', 'wide-7b')
  return { nodes, edges }
}

/** Weights of `graph` at `levels` levels: fixed values that differ by level and edge, with a rest above 0 at every node. */
export function wideWeights(graph: JosekiGraph, levels = 3): GraphWeights {
  const counts = new Int32Array(graph.nodes.length)
  for (const e of graph.edges) counts[e.from]++
  const edge = Array.from({ length: levels }, (_, l) => Float32Array.from(graph.edges, (e, i) => (((i * 7919 + l * 104729) % 1000) / 1000) / (counts[e.from] + 1)))
  const rest = edge.map((values) => {
    const sums = new Float64Array(graph.nodes.length)
    graph.edges.forEach((e, i) => (sums[e.from] += values[i]))
    return Float32Array.from(sums, (s) => Math.max(0, 1 - s))
  })
  return { levels: Array.from({ length: levels }, (_, l) => `${l + 1}k`), edge, rest }
}

export function writeTestGraph(graphFile: string, weightsFile: string): void {
  const graph = testGraph()
  writeFileSync(graphFile, encodeGraph(graph))
  writeFileSync(weightsFile, encodeWeights(testWeights(), graph))
}
