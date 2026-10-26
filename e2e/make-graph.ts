// Writes a small joseki graph and weights for the progress e2e server (port 5186) into its folder: the corner, Q16, the
// White answer R17 (the first position of the e2e start list, e2e/make-starts.ts, Black to move), Black's O17 or its
// mirror R14, and Black's R16 or its mirror Q17 (the list's second position). Two levels of weights that differ in how
// likely the second position is, so that a change of the level changes the progress of the whole list.
//
// Under the first position a line of four more moves leads below it (part 3, the trainer's deep starts): Black P17 (or
// its mirror R15), a White tenuki, Black O16, White P15. The bot's move in it is a tenuki because the fake KataGo's bot
// always leaves the corner (its human policy is uniform, so most of it lies outside the zone): a training from the list
// walks down to Black's turn after the tenuki, where a deeper card can fall due and a queue training can start.
import { writeFileSync } from 'node:fs'
import { canonicalize, trapId } from '../packages/server/src/jdb'
import { lineGraph, type LineEdge } from '../packages/server/src/graph/fixture'
import { encodeGraph, encodeWeights } from '../packages/server/src/graph/format'

// The list ids of the first two start positions: the ids make-starts.ts gives Q16 R17 and Q16 R17 R16.
const firstId = trapId(canonicalize([[15, 3], [16, 2]]))
const secondId = trapId(canonicalize([[15, 3], [16, 2], [16, 3]]))

type Weighted = LineEdge & { p: Record<'5k' | '3d', number> }
const edge = (line: string[], move: string, p5k: number, p3d: number): Weighted => ({ line, move, p: { '5k': p5k, '3d': p3d } })

export function writeProgressGraph(graphFile: string, weightsFile: string): void {
  const { graph, edges } = lineGraph(
    [
      edge([], 'Q16', 0.8, 0.9),
      edge(['Q16'], 'R17', 0.7, 0.5),
      // A symmetric node: a move and its mirror have the same probability.
      edge(['Q16', 'R17'], 'O17', 0.2, 0.1),
      edge(['Q16', 'R17'], 'R14', 0.2, 0.1),
      edge(['Q16', 'R17'], 'R16', 0.15, 0.35),
      edge(['Q16', 'R17'], 'Q17', 0.15, 0.35),
      edge(['Q16', 'R17'], 'tenuki', 0.1, 0.05),
      // The line below the first position.
      edge(['Q16', 'R17'], 'P17', 0.05, 0.02),
      edge(['Q16', 'R17'], 'R15', 0.05, 0.02),
      edge(['Q16', 'R17', 'P17'], 'tenuki', 0.3, 0.2),
      edge(['Q16', 'R17', 'P17', 'tenuki'], 'O16', 0.5, 0.6),
      edge(['Q16', 'R17', 'P17', 'tenuki', 'O16'], 'P15', 0.4, 0.5),
    ],
    { [firstId]: ['Q16', 'R17'], [secondId]: ['Q16', 'R17', 'R16'] },
  )
  const levels = ['5k', '3d'] as const
  const edgeWeights = levels.map((level) => Float32Array.from(edges, (e) => e.p[level]))
  const rest = edgeWeights.map((values) => {
    const sums = new Float64Array(graph.nodes.length)
    graph.edges.forEach((e, i) => (sums[e.from] += values[i]))
    return Float32Array.from(sums, (s) => Math.max(0, 1 - s))
  })
  writeFileSync(graphFile, encodeGraph(graph))
  writeFileSync(weightsFile, encodeWeights({ levels: [...levels], edge: edgeWeights, rest }, graph))
}
