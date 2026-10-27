import { gtpToVertex, type Corner, type Vertex } from '@joseki-dojo/shared'
import { GraphBook } from '../graph/book'
import { lineGraph, lineKey, type LineEdge } from '../graph/fixture'
import { encodeGraph, encodeWeights } from '../graph/format'
import type { ZoneMove } from '../graph/key'
import { fromTopRight } from '../jdb'
import { uniformWeights } from '../progress/fixture'

/** The list id of deepBook() unless it is given another. */
export const DEEP_LIST_ID = 'deep'

/** The line of deepBook() from the empty corner to V, in top-right moves (GTP or 'tenuki'). */
export const DEEP_LINE = ['Q16', 'O17', 'R14', 'tenuki', 'Q13', 'R12', 'Q12', 'tenuki']

/** deepBook() keeps X as the mirror of Q16 O17 R14: the trainer's setups come in that orientation, DEEP_LINE mirrored. */
export const DEEP_LINE_MIRRORED = ['Q16', 'R14', 'O17', 'tenuki', 'N16', 'M17', 'M16', 'tenuki']

/** Top-right moves (GTP or 'tenuki') put in `corner`, top-right by default; a tenuki stays one. */
export const zoneMoves = (line: readonly string[], corner: Corner = 'TR'): ZoneMove[] =>
  line.map((m) => (m === 'tenuki' ? m : fromTopRight(gtpToVertex(m) as Vertex, corner)))

/** The keys of the positions after each move of `line` (top-right moves from the empty corner) past its first `from`: a deep start's path. */
export const lineKeys = (line: readonly string[], from: number): string[] => line.slice(from).map((_, i) => lineKey(line.slice(0, from + i + 1)))

/**
 * A line of the joseki graph for deep starts, in top-right moves from the empty corner, every edge ideal:
 *   the empty corner: Black Q16; Q16: White O17; Q16 O17: Black R14 to X
 *   X = Q16 O17 R14, on the list as `listId`, White to move: a White tenuki to Y
 *   Y: Black Q13 to Z, and Black P13 and O13 without a node
 *   Z: White R12 to T;  T: Black Q12 to U;  U: a White tenuki to V;  V: Black to move, without edges
 * With uniformWeights at `levels` every edge of a node and its rest are equally likely, so Black's three good moves at Y
 * have a third each: for a Black player without habits the path X … V starts at Z, after Y.
 */
export function deepBook(levels: string[], listId = DEEP_LIST_ID): GraphBook {
  const specs: LineEdge[] = DEEP_LINE.map((move, i) => ({ line: DEEP_LINE.slice(0, i), move }))
  const y = DEEP_LINE.slice(0, 4)
  specs.push({ line: y, move: 'P13', expanded: false }, { line: y, move: 'O13', expanded: false })
  const { graph } = lineGraph(specs, { [listId]: DEEP_LINE.slice(0, 3) })
  return GraphBook.load(encodeGraph(graph), encodeWeights(uniformWeights(graph, levels), graph))
}
