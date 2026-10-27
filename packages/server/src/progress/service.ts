import type { CardStage, Color, ProgressDelta, ProgressView, Rating, ReviewData } from '@joseki-dojo/shared'
import { inLearningSteps, newState, schedule, stageOf } from '../cards/schedule'
import type { Thresholds } from '../config'
import type { GraphBook } from '../graph/book'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { computeProgress, nodeCards, type NodeCards, type ProgressResult } from './compute'
import { moveRating, originLength, restRating, restReviewed, walkTraining } from './record'
import type { GraphCardRepo, GraphReview, MoveRaw, RestRaw } from './repo'
import { replayCard } from './replay'

export interface GraphProgressDeps {
  repo: GraphCardRepo
  graph: GraphBook
  /** The start positions, for the moves a start puts on the board. */
  starts: StartBook
  /** Spec (repetition) 3.2: the thresholds of the player's level, read when a training is recorded. */
  thresholds: () => Thresholds
  /** Spec 4: the player's level, read when the progress is computed. */
  level: () => string
  now?: () => Date
  /** One-line diagnostics: a progress gain (part 3 spec 7) that could not be computed or stored; default: silent. */
  log?: (line: string) => void
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** No cards: what computeProgress reads none of, without weights for the level. */
const NO_CARDS: NodeCards = { move: [], rest: [] }

/** Part 3 spec 6.2: a list position for a colour in the queue, with the state of the card that sets its due (spec 6.1). */
export interface GraphQueueItem {
  listId: string
  color: Color
  due: string
  stage: CardStage
  /** The card is in its learning steps: the queue serves it ahead of its due (learn-ahead). */
  learning: boolean
  /** The list position's moves, for the tie order and the small board. */
  moves: string[]
}

/** Spec (progress part 2) 2–3: the graph cards — a move card per node of the player's colour, a rest card per node and colour. */
export class GraphProgressService {
  /**
   * Spec 4.5: the results of the level computed last at `version`, by colour; each holds until the first due of its
   * positions still ahead is reached, which changes their «пора повторить» marks.
   */
  private results: { level: string; version: number; byColor: Map<Color, { result: ProgressResult; until: number }> } | null = null
  /** The player's cards by node at `version`, by colour. */
  private cards: { version: number; byColor: Map<Color, NodeCards> } | null = null
  private changes = 0

  constructor(private readonly d: GraphProgressDeps) {}

  /** +1 on every recording that writes a review and on every level replay: what was computed from the cards before is stale. */
  get version(): number {
    return this.changes
  }

  /**
   * Spec 3: a finished training reviews the graph cards on its walk and marks the positions it met outside the graph, in
   * one transaction; a card that already has a review of this training is left as it is. Part 3 spec 7: with weights for
   * the player's level, a recording that writes a review stores the progress the training gained (deltaOf) — the percent
   * of its list position for its colour, or of the whole list, before and after the reviews; the first one stays. A gain
   * that fails is logged and left out: it never stops the cards from being recorded.
   */
  recordTraining(rec: SessionRecord, review: ReviewData): void {
    const origin = originLength(rec.settings, this.d.starts)
    if (origin === null) return
    const walk = walkTraining(rec, review, this.d.graph, (key) => this.d.repo.seen(key), this.d.thresholds(), origin)
    const reviews = [...walk.moves.map((r) => ({ ...r, kind: 'move' as const })), ...(walk.rest ? [{ ...walk.rest, kind: 'rest' as const }] : [])]
    if (reviews.length === 0 && walk.met.length === 0) return
    // Spec 2.1: the player's colour in the graph's roles (walkTraining), which a training with swapped colours inverts.
    const { color } = walk
    // Part 3 spec 7: the list position in the training's name (a list start, a deep start's name), else the whole list.
    const startId = rec.settings.start?.id
    const listId = startId !== undefined && this.d.graph.listNode(startId) !== null ? startId : null
    const percent = (): number => {
      const view = this.progress(color)
      return listId === null ? view.overall.percent : view.positions[listId].percent
    }
    let before: number | null = null
    try {
      if (this.d.graph.hasLevel(this.d.level())) before = percent()
    } catch (err) {
      this.d.log?.(`progress gain: the percent before training ${rec.id} failed, no gain is stored: ${messageOf(err)}`)
    }
    const { written, created } = this.d.repo.transaction(() => {
      // Stamped when recorded, as the position cards are, so the FSRS state never goes back in time.
      const now = this.now()
      const at = now.toISOString()
      let written = 0
      let created = 0
      for (const { key, kind, raw, auto } of reviews) {
        if (this.d.repo.reviewed(key, kind, color, rec.id)) continue
        const stored = this.d.repo.card(key, kind, color)
        if (!stored && kind === 'move') created++
        const card = stored ?? { key, kind, color, state: newState(now), createdAt: at }
        this.d.repo.upsert({ ...card, state: schedule(card.state, auto, now) })
        this.d.repo.insertReview({ cardKey: key, kind, color, reviewedAt: at, sessionId: rec.id, manual: null, auto, raw })
        written++
      }
      for (const key of walk.met) this.d.repo.markSeen(key, at)
      return { written, created }
    })
    if (written === 0) return
    this.changes++
    if (before === null) return
    try {
      // The recording dropped what was computed before it: this percent is the one after the reviews.
      this.d.repo.insertDelta(rec.id, { listId, color, before, after: percent(), newPositions: created })
    } catch (err) {
      this.d.log?.(`progress gain: training ${rec.id} not stored: ${messageOf(err)}`)
    }
  }

  /** Part 3 spec 7: the progress the training `sessionId` gained, stored when it was recorded; null without one. */
  deltaOf(sessionId: string): ProgressDelta | null {
    return this.d.repo.delta(sessionId)
  }

  /** Spec 4: the progress of the start list for the player's colour `color` at the player's level (result()'s view). */
  progress(color: Color): ProgressView {
    // Without weights for the level there is nothing to compute: no card is read.
    return this.result(color)?.view ?? computeProgress(this.d.graph, this.d.level(), color, NO_CARDS, this.now()).view
  }

  /**
   * Spec 4 and part 3 spec 6.1: the progress of the start list for `color` at the player's level with the cards that set
   * the positions' dues; null without weights for the level. Spec 4.5: it is kept by level and colour; a change of the
   * cards (version) and of the level drop it, and so does the moment one of its positions' dues is reached.
   */
  result(color: Color): ProgressResult | null {
    const level = this.d.level()
    if (!this.d.graph.hasLevel(level)) return null
    const now = this.now()
    if (this.results?.level !== level || this.results.version !== this.changes) this.results = { level, version: this.changes, byColor: new Map() }
    const kept = this.results.byColor.get(color)
    if (kept && now.getTime() < kept.until) return kept.result
    const result = computeProgress(this.d.graph, level, color, this.nodeCards(color), now)
    let until = Infinity
    for (const { state } of result.targets.values()) {
      const due = Date.parse(state.due)
      if (due > now.getTime()) until = Math.min(until, due)
    }
    this.results.byColor.set(color, { result, until })
    return result
  }

  /**
   * Part 3 spec 6.1–6.2: both colours' positions with a due-setting card; null without weights for the player's level. A
   * list position of the graph that the start list does not have is left out: no training can start from it.
   */
  queueItems(): GraphQueueItem[] | null {
    const items: GraphQueueItem[] = []
    for (const color of ['B', 'W'] as const) {
      const result = this.result(color)
      if (!result) return null
      for (const [listId, { state }] of result.targets) {
        const entry = this.d.starts.entryOf(listId)
        if (entry) items.push({ listId, color, due: state.due, stage: stageOf(state), learning: inLearningSteps(state), moves: entry.moves })
      }
    }
    return items
  }

  /** The player's cards of `color` by node (nodeCards), kept until the cards change (version). */
  nodeCards(color: Color): NodeCards {
    if (this.cards?.version !== this.changes) this.cards = { version: this.changes, byColor: new Map() }
    let cards = this.cards.byColor.get(color)
    if (!cards) this.cards.byColor.set(color, (cards = nodeCards(this.d.graph, this.d.repo.allCards(), color)))
    return cards
  }

  /**
   * Spec 5: every graph card again at `thresholds` (the new level's), in one transaction: each review's auto rating
   * derived anew from its raw data (a manual rating stays), the FSRS history replayed from the card's creation. A rest
   * review that makes none at these thresholds (one made by an opponent's mistake alone that is none here, spec 3.3) is
   * skipped and keeps its stored rating for a level where it counts; a card left without reviews is as new, which
   * `progress` counts as no card. Only what changed is written. The version grows, which drops what was computed.
   */
  replayLevel(thresholds: Thresholds): void {
    const derive = (r: GraphReview): Rating | null => {
      if (r.kind === 'move') return moveRating(r.raw as MoveRaw, thresholds)
      const raw = r.raw as RestRaw
      return restReviewed(raw, thresholds) ? restRating(raw, thresholds) : null
    }
    const id = (key: string, kind: string, color: Color): string => `${kind}:${color}:${key}`
    this.d.repo.transaction(() => {
      const byCard = new Map<string, GraphReview[]>()
      for (const r of this.d.repo.allReviews()) {
        const reviews = byCard.get(id(r.cardKey, r.kind, r.color))
        if (reviews) reviews.push(r)
        else byCard.set(id(r.cardKey, r.kind, r.color), [r])
      }
      for (const card of this.d.repo.allCards()) {
        const reviews = byCard.get(id(card.key, card.kind, card.color)) ?? []
        const { state, autos } = replayCard(reviews, derive, card.createdAt)
        if (JSON.stringify(state) !== JSON.stringify(card.state)) this.d.repo.upsert({ ...card, state })
        reviews.forEach((r, i) => {
          const auto = autos[i]
          if (auto !== null && auto !== r.auto) this.d.repo.setAuto(r.id, auto)
        })
      }
    })
    this.changes++
  }

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }
}
