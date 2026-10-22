import type { Color, ProgressView, Rating, ReviewData } from '@joseki-dojo/shared'
import { State } from 'ts-fsrs'
import { newState, schedule, type FsrsState } from '../cards/schedule'
import type { Thresholds } from '../config'
import type { GraphBook } from '../graph/book'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { computeProgress } from './compute'
import { moveRating, restRating, restReviewed, walkTraining } from './record'
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
}

/** Spec (progress part 2) 2–3: the graph cards — a move card per node of the player's colour, a rest card per node and colour. */
export class GraphProgressService {
  /** Spec 4.5: the views of the level computed last, by colour; each holds until the first of its colour's cards comes due. */
  private views: { level: string; byColor: Map<Color, { view: ProgressView; until: number }> } | null = null

  constructor(private readonly d: GraphProgressDeps) {}

  /**
   * Spec 3: a finished training reviews the graph cards on its walk and marks the positions it met outside the graph, in
   * one transaction; a card that already has a review of this training is left as it is.
   */
  recordTraining(rec: SessionRecord, review: ReviewData): void {
    const origin = this.originLength(rec)
    if (origin === null) return
    const walk = walkTraining(rec, review, this.d.graph, (key) => this.d.repo.seen(key), this.d.thresholds(), origin)
    const reviews = [...walk.moves.map((r) => ({ ...r, kind: 'move' as const })), ...(walk.rest ? [{ ...walk.rest, kind: 'rest' as const }] : [])]
    if (reviews.length === 0 && walk.met.length === 0) return
    // Spec 2.1: the player's colour in the graph's roles (walkTraining), which a training with swapped colours inverts.
    const { color } = walk
    this.d.repo.transaction(() => {
      // Stamped when recorded, as the position cards are, so the FSRS state never goes back in time.
      const now = this.d.now?.() ?? new Date()
      const at = now.toISOString()
      for (const { key, kind, raw, auto } of reviews) {
        if (this.d.repo.reviewed(key, kind, color, rec.id)) continue
        const card = this.d.repo.card(key, kind, color) ?? { key, kind, color, state: newState(now), createdAt: at }
        this.d.repo.upsert({ ...card, state: schedule(card.state, auto, now) })
        this.d.repo.insertReview({ cardKey: key, kind, color, reviewedAt: at, sessionId: rec.id, manual: null, auto, raw })
      }
      for (const key of walk.met) this.d.repo.markSeen(key, at)
    })
    this.views = null
  }

  /**
   * Spec 4: the progress of the start list for the player's colour `color` at the player's level. Spec 4.5: the view is
   * kept by level and colour; a new recording and a change of level drop it, and so does the moment one of the colour's
   * cards comes due, which changes its «пора повторить» marks.
   */
  progress(color: Color): ProgressView {
    const level = this.d.level()
    const now = this.d.now?.() ?? new Date()
    // Without weights for the level there is nothing to compute: no card is read.
    if (!this.d.graph.hasLevel(level)) return computeProgress(this.d.graph, level, color, () => null, now)
    if (this.views?.level !== level) this.views = { level, byColor: new Map() }
    const kept = this.views.byColor.get(color)
    if (kept && now.getTime() < kept.until) return kept.view
    const states = { move: new Map<string, FsrsState>(), rest: new Map<string, FsrsState>() }
    let until = Infinity
    for (const c of this.d.repo.allCards()) {
      // A card with no review at this level (replayLevel) is as new: it counts as no card.
      if (c.color !== color || c.state.state === State.New) continue
      states[c.kind].set(c.key, c.state)
      const due = Date.parse(c.state.due)
      if (due > now.getTime()) until = Math.min(until, due)
    }
    const view = computeProgress(this.d.graph, level, color, (key, kind) => states[kind].get(key) ?? null, now)
    this.views.byColor.set(color, { view, until })
    return view
  }

  /**
   * Spec 5: every graph card again at `thresholds` (the new level's), in one transaction: each review's auto rating
   * derived anew from its raw data (a manual rating stays), the FSRS history replayed from the card's creation. A rest
   * review that makes none at these thresholds (one made by an opponent's mistake alone that is none here, spec 3.3) is
   * skipped and keeps its stored rating for a level where it counts; a card left without reviews is as new, which
   * `progress` counts as no card. Only what changed is written. The computed views are dropped.
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
    this.views = null
  }

  /**
   * Spec 2.3: the number of initial moves the training's origin puts on the board — its trap's setup, its start's moves,
   * none for a free game; null for a start the book no longer knows (a replay of it cannot be told apart).
   */
  private originLength(rec: SessionRecord): number | null {
    const { trap, start, corner } = rec.settings
    if (trap) return trap.index
    if (!start) return 0
    if (!this.d.starts.canPlace(start.id)) return null
    return this.d.starts.place(start.id, corner, start.mirror, start.swapColors).length
  }
}
