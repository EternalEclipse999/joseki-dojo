import type { Color, ProgressView } from '@joseki-dojo/shared'
import { State } from 'ts-fsrs'
import type { FsrsState } from '../cards/schedule'
import type { GraphBook } from '../graph/book'
import type { GraphCard, GraphCardKind } from './repo'

const LN_22 = Math.log(22)

/** Spec (progress part 2) 4.1: 0 without a card and for a new one, else min(1, ln(1 + S) / ln 22) of its FSRS stability S in days. */
export const cardPercent = (state: FsrsState | null): number => (!state || state.state === State.New ? 0 : Math.min(1, Math.log(1 + state.stability) / LN_22))

/**
 * Spec 4.2: how the weight of each node goes on. A node of the player's colour has its move card (the node's whole weight);
 * `share[e]` of the weight goes on along edge e into `to[e]` (-1 when it carries nothing on) and `exit[node]` of it to the
 * node's rest card.
 */
export interface Flow {
  player: Uint8Array
  share: Float64Array
  to: Int32Array
  exit: Float64Array
}

/**
 * Part 2 spec 4.2: an opponent's node passes its weight on along each edge with the probability `level` plays it; the
 * rest, an edge without a node and an edge back leave the graph, to the rest card. A player's node passes it on along its
 * good (ideal or good) edges, their probabilities normalised among them — equal shares when the level gives them none at
 * all — and the share of a good edge without a node or back goes to the rest card; with no good edge the whole weight
 * does. The graph must have `level`.
 */
export function progressFlow(graph: GraphBook, level: string, color: Color): Flow {
  const arrays = graph.levelArrays(level)
  if (!arrays) throw new RangeError(`No weights for the level ${level}`)
  const { edge: p, rest } = arrays
  const n = graph.nodeCount
  const flow: Flow = { player: new Uint8Array(n), share: new Float64Array(graph.edgeCount), to: new Int32Array(graph.edgeCount).fill(-1), exit: new Float64Array(n) }
  for (let node = 0; node < n; node++) {
    const first = graph.firstEdge(node)
    const end = graph.firstEdge(node + 1)
    const mine = graph.nodeToMove(node) === color
    let sum = 0
    let count = 0
    if (mine) {
      for (let e = first; e < end; e++) {
        if (!graph.goodEdge(e)) continue
        sum += p[e]
        count++
      }
    }
    let exit = mine ? (count === 0 ? 1 : 0) : rest[node]
    for (let e = first; e < end; e++) {
      if (mine && !graph.goodEdge(e)) continue
      const part = !mine ? p[e] : sum > 0 ? p[e] / sum : 1 / count
      const to = graph.edgeTarget(e)
      if (to < 0 || graph.backEdge(e)) exit += part
      else if (part > 0) {
        flow.share[e] = part
        flow.to[e] = to
      }
    }
    flow.player[node] = mine ? 1 : 0
    flow.exit[node] = exit
  }
  return flow
}

/**
 * The probability of reaching each node from the empty corner along `flow`, in topological order: positions reached by
 * different move orders add up.
 */
export function reachOf(graph: GraphBook, flow: Flow): Float64Array {
  const { share, to } = flow
  const reach = new Float64Array(graph.nodeCount)
  reach[0] = 1
  for (const node of graph.topoOrder()) {
    const r = reach[node]
    if (r === 0) continue
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) reach[to[e]] += r * share[e]
  }
  return reach
}

/** The player's cards of one colour by node; null where there is none or it is new. */
export interface NodeCards {
  move: (FsrsState | null)[]
  rest: (FsrsState | null)[]
}

/**
 * The cards of colour `color` among `cards`, by the node of their key; a card whose key is not in the graph is skipped. A
 * new card (one with no review at the player's level, see GraphProgressService.replayLevel) counts as no card.
 */
export function nodeCards(graph: GraphBook, cards: readonly GraphCard[], color: Color): NodeCards {
  const out: NodeCards = { move: new Array<FsrsState | null>(graph.nodeCount).fill(null), rest: new Array<FsrsState | null>(graph.nodeCount).fill(null) }
  for (const c of cards) {
    if (c.color !== color || c.state.state === State.New) continue
    const node = graph.node(c.key)
    if (node !== null) out[c.kind][node] = c.state
  }
  return out
}

/** Part 3 spec 6.1: the card that sets a position's due. */
export interface DueTarget {
  node: number
  kind: GraphCardKind
  state: FsrsState
}

export interface ProgressResult {
  view: ProgressView
  /** By list id: the position's due-setting card; absent for a position without such a card. */
  targets: ReadonlyMap<string, DueTarget>
}

/**
 * Spec (progress part 2) 4.2–4.4 with the due of part 3 (spec 6.1): the progress of every start list position of `graph`
 * for the player's colour `color` at `level`, from the player's cards of that colour (`cards`).
 *
 * Two passes over the graph without its back edges serve every position at once. Forwards in topological order: the
 * probability of reaching each node from the empty corner (reachOf), a position's weight. Backwards: for each node, the
 * sum of the weights of the cards under it relative to it and the sum weighted by the cards' percents, whose ratio is the
 * node's percent, and the earliest due among the cards under it with a weight above 0 — except the rest cards at the
 * player's nodes: the trainer cannot lead there, whether to leave the graph is the player's choice. The card with that due
 * is the position's target, and the position is due when its due is reached at `now`. A list position nested in another
 * is counted on its own, with its own weight.
 */
export function computeProgress(graph: GraphBook, level: string, color: Color, cards: NodeCards, now: Date): ProgressResult {
  const view: ProgressView = { hasWeights: false, level, color, overall: { percent: 0, due: 0 }, positions: {} }
  const targets = new Map<string, DueTarget>()
  if (!graph.hasLevel(level)) return { view, targets }
  const n = graph.nodeCount
  const flow = progressFlow(graph, level, color)
  const { player, share, to, exit } = flow
  const order = graph.topoOrder()
  const reach = reachOf(graph, flow)

  const weight = new Float64Array(n)
  const score = new Float64Array(n)
  // The earliest due under each node (ms; Infinity without a card that sets one), the node and kind (1: rest) of its card.
  const dueMs = new Float64Array(n)
  const dueNode = new Int32Array(n)
  const dueRest = new Uint8Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const node = order[i]
    let w = exit[node]
    let s = 0
    let d = Infinity
    let dn = -1
    let dr = 0
    if (w > 0) {
      const rest = cards.rest[node]
      s = w * cardPercent(rest)
      if (rest && !player[node]) {
        d = Date.parse(rest.due)
        dn = node
        dr = 1
      }
    }
    if (player[node]) {
      const move = cards.move[node]
      w += 1
      s += cardPercent(move)
      if (move) {
        d = Date.parse(move.due)
        dn = node
      }
    }
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) {
      const t = to[e]
      if (t < 0) continue
      w += share[e] * weight[t]
      s += share[e] * score[t]
      // On an equal due the card found first stays.
      if (dueMs[t] < d) {
        d = dueMs[t]
        dn = dueNode[t]
        dr = dueRest[t]
      }
    }
    weight[node] = w
    score[node] = s
    dueMs[node] = d
    dueNode[node] = dn
    dueRest[node] = dr
  }

  // A node's percent: Σ weight × percent / Σ weight under it; 0 without weight.
  const percentAt = (node: number): number => (weight[node] > 0 ? score[node] / weight[node] : 0)
  const at = now.getTime()
  let sum = 0
  let weighted = 0
  for (let node = 0; node < n; node++) {
    const ids = graph.nodeListIds(node)
    if (ids.length === 0) continue
    const kind: GraphCardKind = dueRest[node] ? 'rest' : 'move'
    const target: DueTarget | null = dueNode[node] < 0 ? null : { node: dueNode[node], kind, state: cards[kind][dueNode[node]]! }
    const due = dueMs[node] <= at
    const dueAt = target ? new Date(dueMs[node]).toISOString() : null
    for (const id of ids) {
      const entry = { percent: percentAt(node), weight: reach[node], due, dueAt }
      view.positions[id] = entry
      if (target) targets.set(id, target)
      sum += entry.weight
      weighted += entry.weight * entry.percent
      if (due) view.overall.due++
    }
  }
  view.overall.percent = sum > 0 ? weighted / sum : 0
  view.hasWeights = true
  return { view, targets }
}
