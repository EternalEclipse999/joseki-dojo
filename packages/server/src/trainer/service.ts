import { nextColor, otherColor, type Color, type Move } from '@joseki-dojo/shared'
import type { BotGuide } from '../bot/bot'
import type { Rng } from '../bot/rng'
import type { AppConfig } from '../config'
import type { GraphBook } from '../graph/book'
import { fromNodeMove, type ZoneMove } from '../graph/key'
import { progressFlow, reachOf } from '../progress/compute'
import { graphWalk, originLength } from '../progress/record'
import type { GraphCardRepo } from '../progress/repo'
import type { GraphProgressService } from '../progress/service'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { habitCounts, habitShares, type HabitShares } from './habits'
import { leaveMove } from './leave'
import { moveNeeds } from './need'
import { nameOnPath, pathTo, randomTarget, realMoves, startIndex, type GraphPath } from './start'

/** Part 3 spec 5.3: a deep start. */
export interface GraphStart {
  /** From the empty corner to the start, in top-right moves, colours from Black (realMoves); a tenuki is put on the board as a pass. */
  setup: ZoneMove[]
  /** From the start to the target: the keys of the path's nodes after the start, the target last (GraphStartRef.path). */
  path: string[]
  /** Spec 5.4: the target is a rest card at a node of the bot, which leaves the graph there. */
  leave: boolean
  /** Spec 5.5: the deepest list position on the way from the empty corner to the start, which names the start. */
  nameId: string
}

export interface TrainerDeps {
  graph: GraphBook
  progress: GraphProgressService
  /** The graph cards' reviews, for the habits. */
  repo: GraphCardRepo
  /** The start positions, for the number of moves a training's origin puts on the board. */
  starts: StartBook
  /** The player's level (`player.level`), read on each call. */
  config: AppConfig
  now?: () => Date
  rng?: Rng
}

/**
 * Part 3 spec 5: the trainer's deep starts in «Случайно» and the queue, and the bot's moves on the way from such a start to
 * its target. It keeps no state of a session (the session's start has its way); only the player's habits, by colour, are
 * kept until the graph cards change (the progress version).
 */
export class TrainerService {
  private readonly rng: Rng
  private habitsKept: { version: number; level: string; byColor: Map<Color, HabitShares> } | null = null

  constructor(private readonly d: TrainerDeps) {
    this.rng = d.rng ?? Math.random
  }

  /**
   * Part 3 spec 5.2 «Случайно»: a list position and a target under it drawn by the need of the player's move cards (colour
   * `color`, a role), then the start on the way to the target (spec 5.3). Null without weights for the player's level or
   * with nothing to learn.
   */
  randomStart(color: Color): GraphStart | null {
    const { graph, config, progress } = this.d
    const level = config.player.level
    if (!graph.hasLevel(level)) return null
    const now = this.d.now?.() ?? new Date()
    const flow = progressFlow(graph, level, color)
    const path = randomTarget(graph, flow, reachOf(graph, flow), moveNeeds(progress.nodeCards(color), now), this.rng)
    return path && this.startOn(path, color, level, false)
  }

  /**
   * Part 3 spec 6.3: the queue's training of the list position `listId` for `color` (a role) — the target is the card that
   * sets the position's due, the way to it a descent from the position (spec 5.2), the start on it (spec 5.3); a rest card
   * (at a node of the bot, by the due rule) makes the bot leave the graph there. Null without weights or without a
   * due-setting card of the position.
   */
  queueStart(listId: string, color: Color): GraphStart | null {
    const { graph, config, progress } = this.d
    const level = config.player.level
    if (!graph.hasLevel(level)) return null
    const target = progress.result(color)?.targets.get(listId)
    const from = graph.listNode(listId)
    if (!target || from === null) return null
    const path = pathTo(graph, progressFlow(graph, level, color), from, target.node, this.rng)
    return path && this.startOn(path, color, level, target.kind === 'rest')
  }

  /**
   * Part 3 spec 5.4: the bot's guide on a deep start's path, or null when the bot plays as now. Only a training that counts
   * (its initial moves are its setup, as the recording has it: a replay from move N has more) of a deep start, at a level
   * with weights, is guided, and only while the walk is in the graph and every move after the setup reaches the path's
   * next node — judged by the node's key, so at a symmetric node either twin move follows the path. At the bot's turn on
   * the path it plays the first edge (in edge order) of its node to the path's next node, in the training's orientation
   * (a tenuki edge as its natural tenuki: the best point outside the corner, a pass when there is none); right after the
   * path of a rest target it leaves the graph with leaveMove. The guide decides on null before any draw from the bot's
   * generator, as BotGuide requires.
   */
  guideFor(rec: SessionRecord): BotGuide | null {
    const { settings, initialMoves, moves } = rec
    const ref = settings.start?.graph
    if (!ref || settings.trap || initialMoves.length !== originLength(settings, this.d.starts)) return null
    const { graph } = this.d
    if (!graph.hasLevel(this.d.config.player.level)) return null
    const n = moves.length
    const onPath = n < ref.path.length
    if (!onPath && !(ref.leave && n === ref.path.length)) return null
    const { corner, userColor } = settings
    const played: Move[] = [...initialMoves, ...moves]
    if (nextColor(played) === userColor) return null
    // The graph's colours are roles, as the training's walk has them (walkTraining): Black is the side that started the corner.
    const swapped = played.length > 0 && played[0].color === 'W'
    const { steps, at } = graphWalk(swapped ? played.map(({ color, vertex }) => ({ color: otherColor(color), vertex })) : played, corner, graph)
    if (!at) return null
    // nodes[k]: the node before move k of the walk, the last one the node after all of them.
    const nodes = [...steps.map((s) => s.node), at.node]
    const setup = initialMoves.length
    if (!ref.path.slice(0, n).every((key, i) => graph.nodeKey(nodes[setup + i + 1]) === key)) return null
    if (!onPath) return (natural, rng) => leaveMove(natural, { graph, node: at.node, mirrored: at.mirrored, corner }, rng)
    const next = graph.node(ref.path[n])
    const edge = next === null ? undefined : graph.edges(at.node).find((e) => e.to === next)
    if (!edge) return null
    const move = fromNodeMove(edge.move, corner, at.mirrored)
    return (natural) => (move !== 'tenuki' ? move : (natural.find((m) => m.tenuki)?.vertex ?? 'pass'))
  }

  /** Spec 5.3: the start on `path` by the habits of the player (`color`) and its moves. */
  private startOn(path: GraphPath, color: Color, level: string, leave: boolean): GraphStart {
    const { graph } = this.d
    const start = startIndex(graph, path, this.habits(color, level), color)
    const keys = path.nodes.slice(start + 1).map((node) => graph.nodeKey(node))
    return { setup: realMoves(graph, path, start), path: keys, leave, nameId: nameOnPath(graph, path, start) }
  }

  /** Spec 4: the player's habits for `color`, the level's probabilities where there are none; kept by the progress version and level. */
  private habits(color: Color, level: string): HabitShares {
    const { graph, progress, repo } = this.d
    if (this.habitsKept?.version !== progress.version || this.habitsKept.level !== level) this.habitsKept = { version: progress.version, level, byColor: new Map() }
    let habits = this.habitsKept.byColor.get(color)
    if (!habits) this.habitsKept.byColor.set(color, (habits = habitShares(graph, habitCounts(graph, repo.allReviews(), color), graph.levelArrays(level)!)))
    return habits
  }
}
