import type { Color, ProgressView } from '@joseki-dojo/shared'
import { State } from 'ts-fsrs'
import type { FsrsState } from '../cards/schedule'
import type { GraphBook } from '../graph/book'
import type { ReadonlyEdge } from '../graph/format'
import type { GraphCardKind } from './repo'

const LN_22 = Math.log(22)

/** Spec (progress part 2) 4.1: 0 without a card and for a new one, else min(1, ln(1 + S) / ln 22) of its FSRS stability S in days. */
export const cardPercent = (state: FsrsState | null): number => (!state || state.state === State.New ? 0 : Math.min(1, Math.log(1 + state.stability) / LN_22))

const isGood = (e: ReadonlyEdge): boolean => e.categories.some((c) => c.category === 'ideal' || c.category === 'good')

/**
 * Spec 4.2: how the weight of each node goes on. A node of the player's colour has its move card (the node's whole weight);
 * `share[e]` of the weight goes on along edge e into `to[e]` (-1 when it carries nothing on) and `exit[node]` of it to the
 * node's rest card.
 */
interface Flow {
  player: Uint8Array
  share: Float64Array
  to: Int32Array
  exit: Float64Array
}

/**
 * Spec 4.2: an opponent's node passes its weight on along each edge with the probability the level plays it; the rest, an
 * edge without a node and an edge back leave the graph, to the rest card. A player's node passes it on along its good
 * (ideal or good) edges, their probabilities normalised among them — equal shares when the level gives them none at all —
 * and the share of a good edge without a node or back goes to the rest card; with no good edge the whole weight does.
 */
function flowOf(graph: GraphBook, level: string, color: Color): Flow {
  const n = graph.nodeCount
  const flow: Flow = { player: new Uint8Array(n), share: new Float64Array(graph.edgeCount), to: new Int32Array(graph.edgeCount).fill(-1), exit: new Float64Array(n) }
  for (let node = 0; node < n; node++) {
    const first = graph.firstEdge(node)
    const edges = graph.edges(node)
    const p = graph.probabilities(node, level)!
    const mine = graph.nodeToMove(node) === color
    let sum = 0
    let count = 0
    if (mine) {
      for (let k = 0; k < edges.length; k++) {
        if (!isGood(edges[k])) continue
        sum += p.edges[k]
        count++
      }
    }
    let exit = mine ? (count === 0 ? 1 : 0) : p.rest
    for (let k = 0; k < edges.length; k++) {
      if (mine && !isGood(edges[k])) continue
      const part = !mine ? p.edges[k] : sum > 0 ? p.edges[k] / sum : 1 / count
      const to = edges[k].to
      if (to === null || graph.backEdge(first + k)) exit += part
      else if (part > 0) {
        flow.share[first + k] = part
        flow.to[first + k] = to
      }
    }
    flow.player[node] = mine ? 1 : 0
    flow.exit[node] = exit
  }
  return flow
}

/**
 * Spec (progress part 2) 4.2–4.4: the progress of every start list position of `graph` for the player's colour `color` at
 * `level`, from the player's cards of that colour (`cards`, null for a card that does not exist).
 *
 * Two passes over the graph without its back edges serve every position at once. Forwards in topological order: the
 * probability of reaching each node from the empty corner (positions reached by different move orders add up), a
 * position's weight. Backwards: for each node, the sum of the weights of the cards under it relative to it and the sum
 * weighted by the cards' percents, whose ratio is the node's percent, and whether a card under it with a weight above 0 is
 * due at `now`. A list position nested in another is counted on its own, with its own weight.
 */
export function computeProgress(graph: GraphBook, level: string, color: Color, cards: (key: string, kind: GraphCardKind) => FsrsState | null, now: Date): ProgressView {
  const view: ProgressView = { hasWeights: false, level, color, overall: { percent: 0, due: 0 }, positions: {} }
  if (!graph.hasLevel(level)) return view
  const n = graph.nodeCount
  const { player, share, to, exit } = flowOf(graph, level, color)
  const order = graph.topoOrder()

  const reach = new Float64Array(n)
  reach[0] = 1
  for (const node of order) {
    const r = reach[node]
    if (r === 0) continue
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) reach[to[e]] += r * share[e]
  }

  const at = now.getTime()
  const isDue = (state: FsrsState | null): boolean => state !== null && Date.parse(state.due) <= at
  const weight = new Float64Array(n)
  const score = new Float64Array(n)
  const due = new Uint8Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const node = order[i]
    let w = exit[node]
    let s = 0
    let d = false
    if (w > 0 || player[node]) {
      const key = graph.nodeKey(node)
      if (w > 0) {
        const rest = cards(key, 'rest')
        s = w * cardPercent(rest)
        d = isDue(rest)
      }
      if (player[node]) {
        const move = cards(key, 'move')
        w += 1
        s += cardPercent(move)
        d ||= isDue(move)
      }
    }
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) {
      if (to[e] < 0) continue
      w += share[e] * weight[to[e]]
      s += share[e] * score[to[e]]
      d ||= due[to[e]] === 1
    }
    weight[node] = w
    score[node] = s
    due[node] = d ? 1 : 0
  }

  let sum = 0
  let weighted = 0
  for (let node = 0; node < n; node++) {
    for (const id of graph.nodeListIds(node)) {
      const entry = { percent: weight[node] > 0 ? score[node] / weight[node] : 0, weight: reach[node], due: due[node] === 1 }
      view.positions[id] = entry
      sum += entry.weight
      weighted += entry.weight * entry.percent
      if (entry.due) view.overall.due++
    }
  }
  view.overall.percent = sum > 0 ? weighted / sum : 0
  view.hasWeights = true
  return view
}
