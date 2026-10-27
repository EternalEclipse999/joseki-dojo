import { isPlayerLevel, type Color, type Rating } from '@joseki-dojo/shared'
import { CALM_SHARE, MISTAKE_TENUKI_RATE, SETTLED_SHARE } from '../../packages/server/src/bot/choose'
import { mulberry32, pick, type Rng } from '../../packages/server/src/bot/rng'
import { inLearningSteps, newState, recall, schedule, type FsrsState } from '../../packages/server/src/cards/schedule'
import { LEARN_AHEAD_MS } from '../../packages/server/src/cards/service'
import type { GraphBook, LevelArrays } from '../../packages/server/src/graph/book'
import { keyHasBothColors } from '../../packages/server/src/graph/key'
import { cardPercent, computeProgress, progressFlow, reachOf, type DueTarget, type Flow, type NodeCards, type ProgressResult } from '../../packages/server/src/progress/compute'
import type { GraphCardKind } from '../../packages/server/src/progress/repo'
import { habitShares, type HabitShares } from '../../packages/server/src/trainer/habits'
import { moveNeeds } from '../../packages/server/src/trainer/need'
import { pathTo, randomTarget, startIndex, type GraphPath } from '../../packages/server/src/trainer/start'

/** Part 3 spec 8.2: the input of a run. The bot plays at the player's level. */
export interface Scenario {
  perDay: number
  days: number
  level: string
  /** The share of the trainings after the queue that are «Из списка»; the rest are «Случайно». */
  list: number
}

/** The scenarios of every trainings-a-day value with every level (`perDay` outer, `levels` inner), half «Из списка». */
export const crossScenarios = (perDay: readonly number[], levels: readonly string[], days: number): Scenario[] =>
  perDay.flatMap((n) => levels.map((level) => ({ perDay: n, days, level, list: 0.5 })))

/** Part 3 spec 8.2: 3, 10 and 30 trainings a day for 90 days at 15k, 5k and 2d, half «Из списка». */
export const DEFAULT_PER_DAY: readonly number[] = [3, 10, 30]
export const DEFAULT_LEVELS: readonly string[] = ['15k', '5k', '2d']
export const DEFAULT_DAYS = 90
export const DEFAULT_SCENARIOS: Scenario[] = crossScenarios(DEFAULT_PER_DAY, DEFAULT_LEVELS, DEFAULT_DAYS)

/** Part 3 spec 8.2: each scenario runs with this many seeds, pooled into one result (pool()). */
export const SEEDS_PER_SCENARIO = 5

/**
 * The lower bounds of the reach bands `seenByReach` splits the seen cards by: reach ≥ 1 %, 0.1–1 % and below (with the
 * positions off the flow, reach 0).
 */
export const REACH_BANDS: readonly number[] = [0.01, 0.001]

/** The band of a reach: 0 from REACH_BANDS[0] on, 1 from REACH_BANDS[1] on, else 2. */
export const reachBand = (reach: number): number => (reach >= REACH_BANDS[0] ? 0 : reach >= REACH_BANDS[1] ? 1 : 2)

/** The lowest and the highest of a measure over the runs. */
export interface MinMax {
  min: number
  max: number
}

/** Part 3 spec 8.3: the measures of one run, or of the runs pooled by pool(); percents and shares are fractions (0..1). */
export interface SimResult {
  scenario: Scenario
  /** The runs behind the result: 1 for simulate(). */
  runs: number
  /** The overall percent at each day's end, the mean of both colours; the mean of the runs. */
  coverage: number[]
  /** The move cards (player nodes) the player has reviewed at least once by each day's end, both colours' summed; the mean of the runs. */
  seen: number[]
  /**
   * The sum of the move cards' percents (cardPercent, 0 for a new card) at each day's end, both colours' summed: the
   * positions mastered, unweighted by how often they come; the mean of the runs.
   */
  mastered: number[]
  /**
   * `seen` split by the reach of the card's position from its list position (listReach at the player's level, along its
   * colour's flow): one curve per band of REACH_BANDS (≥ 1 %, 0.1–1 %, below), at each day's end; the mean of the runs.
   */
  seenByReach: number[][]
  /** The lowest and the highest last-day value of the runs. */
  last: { coverage: MinMax; seen: MinMax; mastered: MinMax }
  /** The share of the reviews of scheduled cards made after their due, and the mean lateness of those in days. */
  late: { share: number; meanDays: number }
  /** The share of trainings whose node sequence repeats the previous one from the same start node. */
  repeat: number
  /** Among the deep starts: the share whose walk reached the target, and the share where the player left the path. */
  deep: { reached: number; deviated: number }
  /** tenukiPercent() at the run's end: the percent of the cards after the bot's tenuki edges, the mean of the colours that have any. */
  tenuki: number
  /** The largest share of a run's trainings that one queue item (a list position and a colour) took; the largest of the runs. */
  queueTop: number
}

/** One training of a run as simulate() reports it (for tests). */
export interface TrainingTrace {
  /** The day, from 0, and the training's time in ms. */
  day: number
  at: number
  mode: 'queue' | 'list' | 'random'
  /** The queue items due at its time before it, learning ahead not counted; null once the day's queue phase is over. */
  waiting: number | null
  color: Color
  /** The nodes the walk went through, from the start. */
  walk: number[]
  /** The reviews in order: the move cards of the player's nodes, then the rest card of the node the walk left the graph at. */
  reviews: { node: number; kind: GraphCardKind; rating: Rating }[]
}

/** The first day's trainings start at 18:00, two minutes apart (part 3 spec 8.2). */
const FIRST_DAY = Date.UTC(2026, 0, 5, 18)
const DAY_MS = 86_400_000
const TRAINING_MS = 2 * 60_000

const tenukiEdges = new WeakMap<GraphBook, Int32Array>()
const goodNodes = new WeakMap<GraphBook, Uint8Array>()

/** The global index of each node's tenuki edge, -1 for a node without one; built once per graph. */
function tenukiEdgeOf(graph: GraphBook): Int32Array {
  let edges = tenukiEdges.get(graph)
  if (!edges) {
    edges = new Int32Array(graph.nodeCount).fill(-1)
    for (let node = 0; node < graph.nodeCount; node++) {
      const k = graph.edges(node).findIndex((e) => e.move === 'tenuki')
      if (k >= 0) edges[node] = graph.firstEdge(node) + k
    }
    tenukiEdges.set(graph, edges)
  }
  return edges
}

/** 1 for each node with a good edge (GraphBook.goodEdge: ideal or good), 0 for a node without edges or with only bad ones; built once per graph. */
function goodNodesOf(graph: GraphBook): Uint8Array {
  let good = goodNodes.get(graph)
  if (!good) {
    good = new Uint8Array(graph.nodeCount)
    for (let node = 0; node < graph.nodeCount; node++) {
      for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end && !good[node]; e++) if (graph.goodEdge(e)) good[node] = 1
    }
    goodNodes.set(graph, good)
  }
  return good
}

/**
 * The largest probability of reaching each node from a list position along `flow` (the part-2 flow of one colour at the
 * player's level): 1 at a list position, 0 for a node under none. Unlike reachOf, it leaves out how often the list position
 * itself comes from the empty corner (1e-8 to 1e-3 on the real graph): it says how rare a branch is in a training that
 * starts at its position. One pass per list position over the topological order from that position on.
 */
export function listReach(graph: GraphBook, flow: Flow): Float64Array {
  const { share, to } = flow
  const order = graph.topoOrder()
  const place = new Int32Array(graph.nodeCount)
  order.forEach((node, i) => (place[node] = i))
  const best = new Float64Array(graph.nodeCount)
  const from = new Float64Array(graph.nodeCount)
  for (let x = 0; x < graph.nodeCount; x++) {
    if (graph.nodeListIds(x).length === 0) continue
    from.fill(0)
    from[x] = 1
    for (let i = place[x]; i < order.length; i++) {
      const node = order[i]
      const r = from[node]
      if (r === 0) continue
      if (r > best[node]) best[node] = r
      for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) if (to[e] >= 0) from[to[e]] += r * share[e]
    }
  }
  return best
}

/**
 * Part 3 spec 12: the percent of the cards after the bot's tenuki edges, weighed as the overall percent weighs them — each
 * list position by its reach (`reach`, reachOf of `flow`) and its id count, the cards under it by the probability of
 * reaching them from it along `flow` (computeProgress) — counting only the weight that passes a tenuki edge of an
 * opponent's node on its way; null when no list position has such weight. `cards`: the player's cards of the flow's colour.
 * The tenuki edges above every list position (at the empty corner and after the first stone, where the bot never plays one)
 * count for nothing, as in the overall percent: no training goes there.
 */
export function tenukiPercent(graph: GraphBook, flow: Flow, reach: Float64Array, cards: NodeCards): number | null {
  const { player, share, to, exit } = flow
  const tenuki = tenukiEdgeOf(graph)
  const order = graph.topoOrder()
  const n = graph.nodeCount
  // Under each node, relative to it: the weight of the cards and that weight times their percents, of all of them and of
  // those after a tenuki of the bot.
  const weight = new Float64Array(n)
  const score = new Float64Array(n)
  const afterWeight = new Float64Array(n)
  const afterScore = new Float64Array(n)
  for (let i = n - 1; i >= 0; i--) {
    const node = order[i]
    let w = exit[node]
    let s = w > 0 ? w * cardPercent(cards.rest[node]) : 0
    if (player[node]) {
      w += 1
      s += cardPercent(cards.move[node])
    }
    let aw = 0
    let as = 0
    for (let e = graph.firstEdge(node), end = graph.firstEdge(node + 1); e < end; e++) {
      const t = to[e]
      if (t < 0) continue
      w += share[e] * weight[t]
      s += share[e] * score[t]
      const after = !player[node] && e === tenuki[node]
      aw += share[e] * (after ? weight[t] : afterWeight[t])
      as += share[e] * (after ? score[t] : afterScore[t])
    }
    weight[node] = w
    score[node] = s
    afterWeight[node] = aw
    afterScore[node] = as
  }
  let sum = 0
  let weighted = 0
  for (let node = 0; node < n; node++) {
    const ids = graph.nodeListIds(node).length
    if (ids === 0 || weight[node] === 0) continue
    const r = (ids * reach[node]) / weight[node]
    sum += r * afterWeight[node]
    weighted += r * afterScore[node]
  }
  return sum > 0 ? weighted / sum : null
}

/**
 * Part 3 spec 8.2: the natural options of an opponent node from the weights at `level` — an approximation of the bot's
 * distribution without a live network answer. π₀ of each edge (aligned with the node's edges) and of leaving the
 * graph (the node's rest). The tenuki edge keeps the bot's rule with its probability as the share of the moves outside the
 * corner: 1 from SETTLED_SHARE on, MISTAKE_TENUKI_RATE from CALM_SHARE on, else 0, and 0 before the joseki starts; the
 * other edges and the rest share what it leaves in proportion to their probabilities. The options sum to 1: when the other
 * options have no probability at all, leaving takes what the tenuki leaves.
 */
export function weightNatural(graph: GraphBook, node: number, level: LevelArrays, josekiStarted: boolean): { edges: Float64Array; leave: number } {
  const first = graph.firstEdge(node)
  const end = graph.firstEdge(node + 1)
  const tenukiEdge = tenukiEdgeOf(graph)[node]
  let others = level.rest[node]
  for (let e = first; e < end; e++) if (e !== tenukiEdge) others += level.edge[e]
  const p = tenukiEdge >= 0 ? level.edge[tenukiEdge] : 0
  const share = p + others > 0 ? p / (p + others) : 0
  const tenuki = tenukiEdge < 0 || !josekiStarted ? 0 : share >= SETTLED_SHARE ? 1 : share >= CALM_SHARE ? MISTAKE_TENUKI_RATE : 0
  const scale = others > 0 ? (1 - tenuki) / others : 0
  const edges = new Float64Array(end - first)
  for (let e = first; e < end; e++) edges[e - first] = e === tenukiEdge ? tenuki : level.edge[e] * scale
  return { edges, leave: others > 0 ? level.rest[node] * scale : 1 - tenuki }
}

/** weightNatural() as one array: the edges, then leaving. */
function naturalOptions(graph: GraphBook, node: number, level: LevelArrays, started: boolean): Float64Array {
  const { edges, leave } = weightNatural(graph, node, level, started)
  const options = new Float64Array(edges.length + 1)
  options.set(edges)
  options[edges.length] = leave
  return options
}

/** A queue item of the model: its due (ms), the depth of its list position and whether its card is in its learning steps. */
export interface QueueCandidate {
  due: number
  depth: number
  learning: boolean
}

/**
 * Part 3 spec 6.2 in the model: the item due at `now` with the earliest due, the deepest on an equal due (the first of
 * equals); when none is due, the earliest one in its learning steps due within LEARN_AHEAD_MS (learning ahead), by the same
 * order; else null.
 */
export function nextQueueItem<T extends QueueCandidate>(items: Iterable<T>, now: number): T | null {
  let due: T | null = null
  let ahead: T | null = null
  const before = (a: T, b: T | null): boolean => b === null || a.due < b.due || (a.due === b.due && a.depth > b.depth)
  for (const item of items) {
    if (item.due <= now) {
      if (before(item, due)) due = item
    } else if (item.learning && item.due <= now + LEARN_AHEAD_MS && before(item, ahead)) ahead = item
  }
  return due ?? ahead
}

/** The model player's memory and record for one colour (a role). */
interface Side {
  color: Color
  cards: NodeCards
  /** Part 3 spec 4: the count of each good edge chosen at a node (aligned with its edges), only for the nodes with any. */
  counts: Map<number, Float64Array>
  /** habitShares() of the nodes with counts, updated when a count changes. */
  own: Map<number, Float64Array>
  habits: HabitShares
  /**
   * Part 3 spec 8.2: the good edge the player plays at a node when it recalls the node's card — the one it played there
   * last, or after «Снова» the one the review showed (shownEdge).
   */
  remembered: Map<number, number>
  /** The part-2 flow at the player's level and its reach: the deep starts descend along it. */
  flow: Flow
  reach: Float64Array
  /** reachBand() of each node's listReach() along `flow`. */
  band: Uint8Array
  /** computeProgress() of the cards; `stale` once a review changed them. */
  progress: ProgressResult
  stale: boolean
}

interface ListPosition {
  id: string
  node: number
  /** The moves of its path: the deepest first on an equal due. */
  depth: number
}

interface QueueItem extends QueueCandidate {
  side: Side
  list: ListPosition
  target: DueTarget
}

interface Start {
  node: number
  /** A deep start's path from the start to its target (part 3 spec 5.4); null for a start at a list position. */
  guide: GraphPath | null
  /** The target is a rest card: the bot leaves the graph there. */
  rest: boolean
}

/** One run of a scenario (part 3 spec 8.2); every draw comes from one seeded generator, in a fixed order. */
class Run {
  private readonly rng: Rng
  private readonly level: LevelArrays
  private readonly hasGood: Uint8Array
  private readonly lists: ListPosition[] = []
  private readonly sides: Side[]
  /** The training's time, in ms and as a date. */
  private now = FIRST_DAY
  private at = new Date(FIRST_DAY)
  /** The trainings after the queue so far: «Из списка» and «Случайно» alternate by the list share. */
  private others = 0
  /** The reviews of the current training, in order. */
  private log: TrainingTrace['reviews'] = []
  private reviews = 0
  private late = 0
  private lateDays = 0
  private trainings = 0
  private repeats = 0
  private deep = 0
  private reached = 0
  private deviated = 0
  private readonly lastWalk = new Map<number, string>()
  /** The trainings each queue item (colour and list id) took. */
  private readonly served = new Map<string, number>()

  constructor(
    private readonly graph: GraphBook,
    private readonly scenario: Scenario,
    seed: number,
    private readonly onTraining?: (trace: TrainingTrace) => void,
  ) {
    const level = graph.levelArrays(scenario.level)
    if (!level) throw new RangeError(`No weights for the level ${scenario.level}`)
    this.level = level
    this.rng = mulberry32(seed)
    this.hasGood = goodNodesOf(graph)
    for (let node = 0; node < graph.nodeCount; node++) {
      for (const id of graph.nodeListIds(node)) this.lists.push({ id, node, depth: graph.nodePath(node).length })
    }
    if (this.lists.length === 0) throw new RangeError('The joseki graph has no list positions')
    // The level's habit shares do not depend on the colour: one cache serves both sides' nodes.
    const base = habitShares(graph, new Map(), this.level)
    this.sides = (['B', 'W'] as const).map((color): Side => {
      const cards: NodeCards = { move: new Array<FsrsState | null>(graph.nodeCount).fill(null), rest: new Array<FsrsState | null>(graph.nodeCount).fill(null) }
      const own = new Map<number, Float64Array>()
      const flow = progressFlow(graph, scenario.level, color)
      return {
        color,
        cards,
        counts: new Map(),
        own,
        habits: (node) => own.get(node) ?? base(node),
        remembered: new Map(),
        flow,
        reach: reachOf(graph, flow),
        band: Uint8Array.from(listReach(graph, flow), reachBand),
        progress: computeProgress(graph, scenario.level, color, cards, this.at),
        stale: false,
      }
    })
  }

  result(): SimResult {
    const { perDay, days } = this.scenario
    const coverage: number[] = []
    const seen: number[] = []
    const mastered: number[] = []
    const seenByReach = Array.from({ length: REACH_BANDS.length + 1 }, (): number[] => [])
    for (let day = 0; day < days; day++) {
      let queue = true
      for (let i = 0; i < perDay; i++) {
        this.setTime(FIRST_DAY + day * DAY_MS + i * TRAINING_MS)
        this.log = []
        // Part 3 spec 8.2: first the queue while it serves, learning ahead included; what is left waits for the next day.
        let waiting: number | null = null
        let training: { mode: TrainingTrace['mode']; side: Side; walk: number[] }
        if (queue) {
          const asked = this.queueItem()
          waiting = asked.waiting
          queue = asked.item !== null
          if (asked.item) {
            training = this.trainQueue(asked.item)
            this.refresh(asked.item.side)
          } else training = this.trainOther()
        } else training = this.trainOther()
        this.onTraining?.({ day, at: this.now, mode: training.mode, waiting, color: training.side.color, walk: training.walk, reviews: this.log })
      }
      this.setTime(this.now + TRAINING_MS)
      for (const side of this.sides) this.refresh(side)
      coverage.push(this.mean((side) => side.progress.view.overall.percent))
      const moveCards = this.moveCards()
      seen.push(moveCards.seen)
      mastered.push(moveCards.mastered)
      moveCards.byReach.forEach((count, b) => seenByReach[b].push(count))
    }
    const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0)
    const last = (curve: number[]): MinMax => ({ min: curve.at(-1) ?? 0, max: curve.at(-1) ?? 0 })
    return {
      scenario: this.scenario,
      runs: 1,
      coverage,
      seen,
      mastered,
      seenByReach,
      last: { coverage: last(coverage), seen: last(seen), mastered: last(mastered) },
      late: { share: share(this.late, this.reviews), meanDays: share(this.lateDays, this.late) },
      repeat: share(this.repeats, this.trainings),
      deep: { reached: share(this.reached, this.deep), deviated: share(this.deviated, this.deep) },
      tenuki: this.tenukiCoverage(),
      queueTop: share(Math.max(0, ...this.served.values()), this.trainings),
    }
  }

  private mean(of: (side: Side) => number): number {
    return this.sides.reduce((sum, side) => sum + of(side), 0) / this.sides.length
  }

  /** The move cards of both colours the player has reviewed (seen), the sum of their percents (mastered) and their count by reach band. */
  private moveCards(): { seen: number; mastered: number; byReach: number[] } {
    let seen = 0
    let mastered = 0
    const byReach = new Array<number>(REACH_BANDS.length + 1).fill(0)
    for (const side of this.sides) {
      const { move } = side.cards
      for (let node = 0; node < move.length; node++) {
        const card = move[node]
        if (card) {
          seen++
          mastered += cardPercent(card)
          byReach[side.band[node]]++
        }
      }
    }
    return { seen, mastered, byReach }
  }

  private setTime(ms: number): void {
    this.now = ms
    this.at = new Date(ms)
  }

  private refresh(side: Side): void {
    if (!side.stale) return
    side.progress = computeProgress(this.graph, this.scenario.level, side.color, side.cards, this.at)
    side.stale = false
  }

  /** Part 3 spec 6.2: the queue's next (list position, colour) item by its due-setting card (nextQueueItem), and the count of the items due. */
  private queueItem(): { item: QueueItem | null; waiting: number } {
    const items: QueueItem[] = []
    for (const side of this.sides) {
      for (const list of this.lists) {
        const target = side.progress.targets.get(list.id)
        if (target) items.push({ side, list, target, due: Date.parse(target.state.due), depth: list.depth, learning: inLearningSteps(target.state) })
      }
    }
    return { item: nextQueueItem(items, this.now), waiting: items.filter((item) => item.due <= this.now).length }
  }

  /** Part 3 spec 6.3: a queue training — the path from the position to its target, the start by the ½ rule. */
  private trainQueue({ side, list, target }: QueueItem): { mode: 'queue'; side: Side; walk: number[] } {
    const key = `${side.color}:${list.id}`
    this.served.set(key, (this.served.get(key) ?? 0) + 1)
    const path = pathTo(this.graph, side.flow, list.node, target.node, this.rng)
    return { mode: 'queue', side, walk: this.train(side, path ? this.deepStart(side, path, target.kind === 'rest') : { node: list.node, guide: null, rest: false }) }
  }

  /**
   * After the queue: «Из списка» (a list position uniformly at random, started at its node) and «Случайно» (part 3 spec
   * 5.2: a deep start; at a random list position when no card under any has a need) alternate by the list share; the
   * colour is drawn first.
   */
  private trainOther(): { mode: 'list' | 'random'; side: Side; walk: number[] } {
    const { list } = this.scenario
    const fromList = Math.floor((this.others + 1) * list + 0.5) > Math.floor(this.others * list + 0.5)
    this.others++
    const side = this.sides[this.rng() < 0.5 ? 0 : 1]
    if (fromList) return { mode: 'list', side, walk: this.train(side, this.listStart()) }
    const path = randomTarget(this.graph, side.flow, side.reach, moveNeeds(side.cards, this.at), this.rng)
    return { mode: 'random', side, walk: this.train(side, path ? this.deepStart(side, path, false) : this.listStart()) }
  }

  private listStart(): Start {
    return { node: this.lists[Math.floor(this.rng() * this.lists.length)].node, guide: null, rest: false }
  }

  private deepStart(side: Side, path: GraphPath, rest: boolean): Start {
    const j = startIndex(this.graph, path, side.habits, side.color)
    return { node: path.nodes[j], guide: { nodes: path.nodes.slice(j), edges: path.edges.slice(j) }, rest }
  }

  /**
   * Part 3 spec 8.2: one training from `start` until it leaves the graph — on the bot's leaving option, an edge without a
   * node or a back edge (either side), the player's move off the dictionary (playerMove) or at a rest target. The player's
   * moves review their move cards; the node it leaves at reviews the player's rest card. The walk's nodes.
   */
  private train(side: Side, start: Start): number[] {
    const { graph } = this
    const { guide } = start
    const pathNodes = guide?.nodes ?? []
    const pathEdges = guide?.edges ?? []
    const target = guide ? pathNodes[pathNodes.length - 1] : -1
    let node = start.node
    // The index of `node` on the guide while the walk follows it (pathEdges.length at the target), -1 once dropped or done.
    let g = guide ? 0 : -1
    const walk = [node]
    let reached = node === target
    let deviated = false
    for (;;) {
      let edge: number // -1: the walk leaves the graph at `node`
      if (graph.nodeToMove(node) === side.color) {
        edge = this.playerMove(side, node)
        if (g >= 0 && g < pathEdges.length && edge >= 0 && graph.edgeTarget(edge) === pathNodes[g + 1]) g++
        else if (g >= 0) {
          deviated ||= g < pathEdges.length
          g = -1
        }
      } else if (g >= 0 && g < pathEdges.length) edge = pathEdges[g++]
      else if (g >= 0 && start.rest) edge = -1
      else {
        g = -1
        edge = this.botEdge(node)
      }
      const to = edge < 0 ? -1 : graph.edgeTarget(edge)
      if (to < 0 || graph.backEdge(edge)) break
      node = to
      walk.push(node)
      if (node === target) reached = true
    }
    this.restReview(side, node)
    this.trainings++
    const key = walk.join(',')
    if (this.lastWalk.get(start.node) === key) this.repeats++
    this.lastWalk.set(start.node, key)
    if (guide) {
      this.deep++
      if (reached) this.reached++
      if (deviated) this.deviated++
    }
    return walk
  }

  /**
   * Part 3 spec 8.2: the player's move at its node — a global edge, or -1 for a move off the dictionary, which leaves the
   * graph. With a card the player recalls it with the card's probability R (one draw).
   * - At a node without a good edge (no edges, or only bad ones) the right move is off the dictionary: a player who recalls
   *   leaves the graph with it, rated «Хорошо» with no second draw. (A new card would be «Трудно», but the model has none: a
   *   node's card is null until its first review, and the `card !== null` guard keeps it from being recalled.)
   * - Otherwise a player who recalls plays the good edge it remembers there, when it has one.
   * - A player who does not recall, at a new node or without a remembered edge, plays as a player of the level: an edge by
   *   the level's probabilities normalised over the node's edges (equal shares when they sum to 0); at a node without edges
   *   it leaves the graph, rated «Снова».
   * A good edge is rated «Хорошо», counted for the habit and remembered; any other «Снова», and the move the review shows is
   * remembered (shownEdge).
   */
  private playerMove(side: Side, node: number): number {
    const { graph } = this
    const first = graph.firstEdge(node)
    const end = graph.firstEdge(node + 1)
    const card = side.cards.move[node]
    const recalled = card !== null && this.rng() < recall(card, this.at)
    if (!this.hasGood[node] && (recalled || first === end)) {
      this.review(side, 'move', node, recalled ? 'good' : 'again')
      return -1
    }
    let edge = recalled ? (side.remembered.get(node) ?? -1) : -1
    if (edge < 0) {
      const { edge: p } = this.level
      let sum = 0
      for (let e = first; e < end; e++) sum += p[e]
      edge = pick(Array.from({ length: end - first }, (_, k) => first + k), (e) => (sum > 0 ? p[e] : 1), this.rng)
    }
    if (graph.goodEdge(edge)) {
      this.review(side, 'move', node, 'good')
      side.remembered.set(node, edge)
      let counts = side.counts.get(node)
      if (!counts) side.counts.set(node, (counts = new Float64Array(end - first)))
      counts[edge - first]++
      side.own.set(node, habitShares(graph, side.counts, this.level)(node))
    } else {
      this.review(side, 'move', node, 'again')
      if (this.hasGood[node]) side.remembered.set(node, this.shownEdge(first, end))
    }
    return edge
  }

  /** Part 3 spec 8.2 (the owner's decision): the move a review shows after «Снова» — the good edge the level plays most often among `first`..`end`, the first of equals. */
  private shownEdge(first: number, end: number): number {
    const { edge: p } = this.level
    let shown = -1
    for (let e = first; e < end; e++) if (this.graph.goodEdge(e) && (shown < 0 || p[e] > p[shown])) shown = e
    return shown
  }

  /** Part 3 spec 8.2: the review of the rest card where the walk left the graph — new: «Трудно» (the first-time rule); else «Хорошо» with its R, «Снова» otherwise. */
  private restReview(side: Side, node: number): void {
    const card = side.cards.rest[node]
    this.review(side, 'rest', node, !card ? 'hard' : this.rng() < recall(card, this.at) ? 'good' : 'again')
  }

  /** The app's scheduling of a review at the training's time; the review of a scheduled card after its due is late. */
  private review(side: Side, kind: GraphCardKind, node: number, rating: Rating): void {
    const cards = side.cards[kind]
    const card = cards[node]
    if (card) {
      this.reviews++
      const late = this.now - Date.parse(card.due)
      if (late > 0) {
        this.late++
        this.lateDays += late / DAY_MS
      }
    }
    cards[node] = schedule(card ?? newState(this.at), rating, this.at)
    side.stale = true
    this.log.push({ node, kind, rating })
  }

  /**
   * Part 3 spec 3 and 8.2: the natural bot's choice at its node — an option of weightNatural() at the bot's level (the
   * player's) ∝ its probability, one draw. The global edge, or -1 for leaving the graph. (Weighting these options by the
   * need behind them was measured with this simulator and removed.)
   */
  private botEdge(node: number): number {
    const { graph } = this
    // The app's «joseki started» flag is sticky: it stays set once the zone has held stones of both colours in the session.
    // The node's own stones approximate it; they differ only after a capture leaves one colour without a stone in the zone.
    const started = keyHasBothColors(graph.nodeKey(node))
    const natural = naturalOptions(graph, node, this.level, started)
    const k = pick(Array.from(natural.keys()), (k) => natural[k], this.rng)
    return k === natural.length - 1 ? -1 : graph.firstEdge(node) + k
  }

  /** Part 3 spec 12: tenukiPercent() of each colour, the mean over the colours that have cards after a tenuki of the bot; 0 without any. */
  private tenukiCoverage(): number {
    const percents = this.sides.flatMap((side) => tenukiPercent(this.graph, side.flow, side.reach, side.cards) ?? [])
    return percents.length > 0 ? percents.reduce((a, b) => a + b) / percents.length : 0
  }
}

/** Part 3 spec 8.2–8.3: one run of `scenario` with the natural bot, every draw from `seed`; `onTraining` sees each training as it ends. */
export function simulate(graph: GraphBook, scenario: Scenario, seed: number, onTraining?: (trace: TrainingTrace) => void): SimResult {
  return new Run(graph, scenario, seed, onTraining).result()
}

export const scenarioName = (s: Scenario): string => `${s.perDay} a day for ${s.days} days at ${s.level}, ${Math.round(100 * s.list)} % from the list`

/**
 * Part 3 spec 8.3: the runs of one scenario (with different seeds) as one result — the curves (coverage, seen, mastered)
 * and the other measures their means (weighted by the runs behind each), the curves' last days from the lowest to the
 * highest, and the largest queue top.
 */
export function pool(results: readonly SimResult[]): SimResult {
  const [first] = results
  if (!first || results.some((r) => scenarioName(r.scenario) !== scenarioName(first.scenario))) throw new RangeError('pool() takes the runs of one scenario')
  const runs = results.reduce((sum, r) => sum + r.runs, 0)
  const mean = (of: (r: SimResult) => number): number => results.reduce((sum, r) => sum + of(r) * r.runs, 0) / runs
  const curve = (of: (r: SimResult) => number[]): number[] => of(first).map((_, d) => mean((r) => of(r)[d]))
  const range = (of: (r: SimResult) => MinMax): MinMax => ({ min: Math.min(...results.map((r) => of(r).min)), max: Math.max(...results.map((r) => of(r).max)) })
  return {
    scenario: first.scenario,
    runs,
    coverage: curve((r) => r.coverage),
    seen: curve((r) => r.seen),
    mastered: curve((r) => r.mastered),
    seenByReach: first.seenByReach.map((_, b) => curve((r) => r.seenByReach[b])),
    last: { coverage: range((r) => r.last.coverage), seen: range((r) => r.last.seen), mastered: range((r) => r.last.mastered) },
    late: { share: mean((r) => r.late.share), meanDays: mean((r) => r.late.meanDays) },
    repeat: mean((r) => r.repeat),
    deep: { reached: mean((r) => r.deep.reached), deviated: mean((r) => r.deep.deviated) },
    tenuki: mean((r) => r.tenuki),
    queueTop: Math.max(...results.map((r) => r.queueTop)),
  }
}

const percent = (x: number): string => `${(100 * x).toFixed(1)} %`

/** The days the report shows by default: 30, 60 and the last one (`days`), those within the run. */
export const defaultCheckpoints = (days: number): number[] => [...new Set([30, 60, days])].filter((d) => d >= 1 && d <= days).sort((a, b) => a - b)

/** Columns padded to their widest cell: the first `left` ones to the left, the others to the right. */
function table(rows: string[][], left = 1): string[] {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => r[c].length)))
  return rows.map((r) => r.map((cell, c) => (c < left ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  ').trimEnd())
}

/**
 * Part 3 spec 8.3: the report — a header, then for each scenario (its pooled runs, pool()) two tables: the measures of the
 * whole run, and the coverage at each of `checkpoints` (days; by default defaultCheckpoints(), the last day always) — the
 * percent, the cards seen by reach band and mastered, with the ranges of the runs on the last day; then a legend.
 */
export function report(results: readonly SimResult[], checkpoints?: readonly number[]): string {
  const runs = results[0]?.runs ?? 1
  const lines = [`Trainer simulation, the natural bot: each scenario pools ${runs === 1 ? '1 run' : `${runs} runs with different seeds`}.`]
  for (const r of results) {
    const days = r.coverage.length
    const shown = [...new Set([...(checkpoints ?? defaultCheckpoints(days)).filter((d) => d >= 1 && d <= days), days])].sort((a, b) => a - b)
    const at = (curve: number[], d: number): string => (curve[d - 1] ?? 0).toFixed(1)
    const measures = [
      ['late', 'late days', 'repeat', 'reached', 'deviated', 'tenuki', 'queue top'],
      [percent(r.late.share), r.late.meanDays.toFixed(2), percent(r.repeat), percent(r.deep.reached), percent(r.deep.deviated), percent(r.tenuki), percent(r.queueTop)],
    ]
    // One row per checkpoint; the ranges of the runs on the last day only.
    const coverage = [
      ['day', 'coverage', 'min–max', 'seen', 'min–max', 'seen ≥ 1 %', 'seen 0.1–1 %', 'seen < 0.1 %', 'mastered', 'min–max'],
      ...shown.map((d) => {
        const last = d === days
        return [
          `d${d}`,
          percent(r.coverage[d - 1] ?? 0),
          last ? `${(100 * r.last.coverage.min).toFixed(1)}–${(100 * r.last.coverage.max).toFixed(1)} %` : '',
          at(r.seen, d),
          last ? `${r.last.seen.min.toFixed(0)}–${r.last.seen.max.toFixed(0)}` : '',
          ...r.seenByReach.map((curve) => at(curve, d)),
          at(r.mastered, d),
          last ? `${r.last.mastered.min.toFixed(1)}–${r.last.mastered.max.toFixed(1)}` : '',
        ]
      }),
    ]
    lines.push('', scenarioName(r.scenario), ...table(measures, 0).map((l) => `  ${l}`), '', ...table(coverage).map((l) => `  ${l}`))
  }
  lines.push(
    '',
    'The measures are the mean of the runs unless said otherwise.',
    'late: the share of the reviews of scheduled cards made after their due, and their mean lateness in days.',
    'repeat: the trainings whose path repeats the previous one from the same start. reached, deviated: the deep starts that reached their target, and those where the player left the path.',
    'tenuki: the percent of the cards after the bot’s tenuki edges at the end, weighed as in the overall percent (the list positions by their reach, the cards under each by the probability of reaching them); the mean of the colours that have such cards.',
    'queue top: the largest share of a run’s trainings that one queue item (a list position and a colour) took, the largest of the runs.',
    'coverage: the overall percent at the end of the day (both colours); min–max: the lowest and the highest value of the runs on the last day, of the column before it.',
    'seen: the move cards the player has reviewed at least once, both colours summed; split by the reach of their position from its list position (the largest probability of reaching it from a list position along the part-2 flow at the player’s level): ≥ 1 %, 0.1–1 %, < 0.1 % (with the positions off that flow, after the player’s own bad moves).',
    'mastered: the sum of their percents, ln(1 + S) / ln 22 up to 1, unweighted by how often the positions come.',
  )
  return lines.join('\n')
}

export interface SimOptions {
  scenarios: Scenario[]
  /** The days the report shows, ascending; the last day of the runs is always one. */
  checkpoints: number[]
  /** The first of the SEEDS_PER_SCENARIO seeds each scenario runs with. */
  seed: number
  jobs: number
  out: string | null
}

/** The memory a worker thread takes at most: the graph, its weights and a run (about 0.4 GB measured on a 30-a-day run). */
export const WORKER_BYTES = 0.45 * 2 ** 30

/** The default --jobs: all CPUs but one, and no more workers than fit in 60 % of the machine's memory (`memory`, bytes). */
export const defaultJobs = (cpus: number, memory: number): number => Math.max(1, Math.min(cpus - 1, Math.floor((0.6 * memory) / WORKER_BYTES)))

const USAGE =
  'npm run trainer:sim [--per-day N,N…] [--levels L,L…] [--days N] [--checkpoints D,D…] [--seed N] [--jobs N] [--out FILE]' +
  ' (the scenarios are every --per-day with every level; the report shows the checkpoint days and always the last day)'

/**
 * `npm run trainer:sim` options; the runs go to defaultJobs(`cpus`, `memory`) worker threads unless --jobs says otherwise.
 * The scenarios are the cross product of --per-day and --levels for --days (by default DEFAULT_SCENARIOS); --checkpoints
 * the days the report shows besides the last (by default defaultCheckpoints()). A list is comma-separated, without repeats.
 */
export function parseSimOptions(args: readonly string[], cpus: number, memory: number): SimOptions {
  const fail = (): never => {
    throw new Error(`Usage: ${USAGE}`)
  }
  const positive = (s: string | undefined): number => {
    const n = Number(s)
    return Number.isInteger(n) && n > 0 ? n : fail()
  }
  const list = <T>(value: string, item: (s: string) => T): T[] => {
    const items = value.split(',')
    return new Set(items).size === items.length ? items.map(item) : fail()
  }
  let perDay = DEFAULT_PER_DAY
  let levels = DEFAULT_LEVELS
  let days = DEFAULT_DAYS
  let checkpoints: number[] | null = null
  const opts: SimOptions = { scenarios: DEFAULT_SCENARIOS, checkpoints: [], seed: 1, jobs: defaultJobs(cpus, memory), out: null }
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1]
    if (value === undefined) fail()
    if (args[i] === '--per-day') perDay = list(value, positive)
    else if (args[i] === '--levels') levels = list(value, (s) => (isPlayerLevel(s) ? s : fail()))
    else if (args[i] === '--days') days = positive(value)
    else if (args[i] === '--checkpoints') checkpoints = list(value, positive)
    else if (args[i] === '--seed') {
      const seed = Number(value)
      opts.seed = Number.isInteger(seed) && seed >= 0 ? seed : fail()
    } else if (args[i] === '--jobs') opts.jobs = positive(value)
    else if (args[i] === '--out') opts.out = value
    else fail()
  }
  if (checkpoints?.some((d) => d > days)) fail()
  opts.scenarios = crossScenarios(perDay, levels, days)
  opts.checkpoints = checkpoints ? [...new Set([...checkpoints, days])].sort((a, b) => a - b) : defaultCheckpoints(days)
  return opts
}
