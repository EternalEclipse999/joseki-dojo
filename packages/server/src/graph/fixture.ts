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
