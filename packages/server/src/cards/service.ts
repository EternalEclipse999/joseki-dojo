import { randomUUID } from 'node:crypto'
import { colorSign, Position, type CardKind, type CardListItem, type CardStage, type CardSummary, type Color, type DueCard, type Move, type ProblemAnswer, type Rating, type RepetitionInfo, type ReviewData, type StartCardState, type Vertex } from '@joseki-dojo/shared'
import { DEFAULT_CONFIG, type Thresholds } from '../config'
import { EngineError } from '../engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { moveRating } from '../progress/record'
import type { MoveRaw } from '../progress/repo'
import { replayCard } from '../progress/replay'
import type { GraphQueueItem } from '../progress/service'
import { categorize } from '../review/compute'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { positionRating, positionRaw, ratePosition, type PositionRaw } from './grade'
import { candidateLoss, findProblems, lossAfter, problemKey, zoneStones, type ProblemData } from './problem'
import type { CardRepo, CardRow, ReviewRow } from './repo'
import { dayStart, inLearningSteps, newState, schedule, stageOf } from './schedule'

export class CardError extends Error {
  constructor(readonly code: 'card_not_found' | 'review_not_found' | 'not_latest' | 'wrong_kind' | 'illegal_move' | 'engine_unavailable') {
    super(code)
  }
}

export interface CardServiceDeps {
  repo: CardRepo
  starts: StartBook
  now?: () => Date
  newId?: () => string
  /** Judges an answer that is not among a problem's stored candidates. */
  judge?: {
    analyze: (q: KataGoQueryBody) => Promise<AnalysisResponse>
    ready: () => boolean
    thresholds: () => Thresholds
    visits: () => number
  }
  /** One-line diagnostics: an old training that a level replay could not rebuild. */
  log?: (line: string) => void
  /**
   * Part 3 spec 6.2: the list positions for a colour that the queue serves by the due of their graph cards; null without
   * weights for the player's level, when the position cards make the queue as before (spec 6.4).
   */
  graphQueue?: () => GraphQueueItem[] | null
}

interface PositionData {
  startId: string
  userColor: 'B' | 'W'
  botRank: string
}

/** Spec (repetition) 5.2: when nothing is due, the queue serves a card in its learning steps due this soon (as Anki does). */
export const LEARN_AHEAD_MS = 20 * 60_000

const startIdOf = (c: CardRow): string => String((c.data as Partial<PositionData>).startId ?? '')

/** The same as JSON: a level replay writes only what it changed. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** An entry of the queue: a card, or (part 3 spec 6.2) a list position's graph item for a colour, of kind 'position'. */
type Entry = { id: string; kind: CardKind; due: string; stage: CardStage; learning: boolean } & ({ card: CardRow; item: null } | { card: null; item: GraphQueueItem })

const cardEntry = (card: CardRow): Entry => ({ id: card.id, kind: card.kind, due: card.state.due, stage: stageOf(card.state), learning: inLearningSteps(card.state), card, item: null })

/** Part 3 spec 6.2: a graph item's id is no card's, so it cannot be deleted. */
const itemEntry = (item: GraphQueueItem): Entry => ({ id: `graph:${item.listId}:${item.color}`, kind: 'position', due: item.due, stage: item.stage, learning: item.learning, card: null, item })

/**
 * Part 3 spec 6.2: the queue's order with weights — by due; on an equal due a card (a problem) before a graph item, and the
 * deeper of two graph items first (one card can set the due of nested positions); then by id, as the repo orders the
 * cards (due, id).
 */
const queueOrder = (a: Entry, b: Entry): number =>
  Date.parse(a.due) - Date.parse(b.due) ||
  (a.item && b.item ? b.item.moves.length - a.item.moves.length : Number(a.item !== null) - Number(b.item !== null)) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** What a level-change replay derives anew for a review. */
type Replayed = Pick<ReviewRow, 'auto' | 'worst' | 'raw'>

/**
 * Spec (progress part 2) 5: a position review at `th`, from its raw losses; an older review without them from its
 * training rebuilt at `th` (`reviewOf`) while it is in the database, else from its stored worst move. The losses it is
 * rated from become its raw losses. An older review with an unpunished bot mistake as its worst (the bot's loss is not
 * kept) or without a worst move stays as it is.
 */
function replayedPosition(r: ReviewRow, th: Thresholds, reviewOf: (sessionId: string) => ReviewData | null): Replayed {
  let raw = r.raw as PositionRaw | null
  if (!raw && r.sessionId) {
    const rebuilt = reviewOf(r.sessionId)
    raw = rebuilt ? positionRaw(rebuilt) : null
  }
  if (!raw && r.worst && r.worst.category !== 'unpunished') raw = { moves: [{ loss: r.worst.loss }], opponent: [] }
  if (!raw) return { auto: r.auto, worst: r.worst, raw: null }
  const { rating, worst } = ratePosition(raw, th)
  return { auto: rating, worst, raw }
}

/**
 * Spec (progress part 2) 5: a problem review at `th`. An answer is rated from its loss and whether it was the best move
 * (an older answer from its stored worst move, or as the best move when it was «Легко»); the review of a training that
 * made or repeated the problem stays «Снова» (spec repetition 4.2).
 */
function replayedProblem(r: ReviewRow, th: Thresholds): Replayed {
  if (r.sessionId !== null) return { auto: r.auto, worst: r.worst, raw: r.raw }
  const older: MoveRaw | null = r.worst ? { loss: r.worst.loss, best: false } : r.auto === 'easy' ? { loss: 0, best: true } : null
  const raw = (r.raw as MoveRaw | null) ?? older
  if (!raw) return { auto: r.auto, worst: r.worst, raw: null }
  const category = categorize(raw.loss, th)
  return { auto: moveRating(raw, th), worst: category === 'exact' ? null : { category, loss: raw.loss }, raw }
}

/** Spec (repetition) 4–5: cards, their schedule and the queue: position cards and «find a good move» problem cards. */
export class CardService {
  constructor(private readonly d: CardServiceDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  /** Spec (repetition) 4.2: a finished training repeats its position card and makes or repeats its problem cards. */
  recordTraining(rec: SessionRecord, review: ReviewData): void {
    this.recordPosition(rec, review)
    this.recordProblems(rec, review)
  }

  /** Spec (repetition) 4.2: a finished training of a listed start is a repetition of its position card; a deep start is none (part 3 spec 5.5). */
  private recordPosition(rec: SessionRecord, review: ReviewData): void {
    const start = rec.settings.start
    if (!start || start.dubious || start.graph) return
    const entry = this.d.starts.list().find((e) => e.id === start.id)
    // Spec 4.2: only a training that began at the start position repeats the card (a replay from move N has more initial moves).
    if (!entry || rec.initialMoves.length > entry.moves.length) return
    const auto = positionRating(review)
    if (!auto) return
    const key = `position:${start.id}`
    this.d.repo.transaction(() => {
      let card = this.d.repo.cardByKey(key)
      if (card?.deleted) return
      if (card && this.d.repo.reviewBySession(card.id, rec.id)) return
      // The review is stamped when it is recorded, not at the training's finish time, so the FSRS state never goes back in time.
      const now = this.now()
      if (!card) {
        const data: PositionData = { startId: start.id, userColor: rec.settings.userColor, botRank: rec.settings.botRank }
        const row = { id: this.d.newId?.() ?? randomUUID(), kind: 'position' as const, key, data: { ...data }, state: newState(now), createdAt: now.toISOString() }
        this.d.repo.insertCard(row)
        card = { ...row, deleted: false }
      }
      const stateBefore = card.state
      this.d.repo.updateState(card.id, schedule(stateBefore, auto.rating, now))
      // Spec (progress part 2) 5: the raw losses too, so that a level change re-rates the review without the training.
      this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: auto.rating, auto: auto.rating, worst: auto.worst, stateBefore, sessionId: rec.id, raw: positionRaw(review) })
    })
  }

  /** Spec (repetition) 4.2: every problem of the training — a new card starts with «Снова», an existing one gets an «again» review once per training. */
  private recordProblems(rec: SessionRecord, review: ReviewData): void {
    for (const p of findProblems(rec, review)) {
      const key = problemKey(p.moves, p.corner, p.toMove)
      this.d.repo.transaction(() => {
        let card = this.d.repo.cardByKey(key)
        if (card?.deleted) return
        if (card && this.d.repo.reviewBySession(card.id, rec.id)) return
        const now = this.now()
        if (!card) {
          const row = { id: this.d.newId?.() ?? randomUUID(), kind: 'move' as const, key, data: { ...p } as unknown as Record<string, unknown>, state: newState(now), createdAt: now.toISOString() }
          this.d.repo.insertCard(row)
          card = { ...row, deleted: false }
        }
        const stateBefore = card.state
        this.d.repo.updateState(card.id, schedule(stateBefore, 'again', now))
        this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: 'again', auto: 'again', worst: null, stateBefore, sessionId: rec.id, raw: null })
      })
    }
  }

  private info(row: ReviewRow, card: CardRow): RepetitionInfo {
    return { cardId: card.id, reviewId: row.id, auto: row.auto, rating: row.rating, worst: row.worst, editable: this.d.repo.latestReviewId(card.id) === row.id, due: card.state.due }
  }

  /** Spec (repetition) 5.3: the repetition shown over the review of `sessionId`. */
  repetitionOf(sessionId: string): RepetitionInfo | null {
    const row = this.d.repo.positionReviewOfSession(sessionId)
    const card = row ? this.d.repo.card(row.cardId) : null
    return row && card && !card.deleted ? this.info(row, card) : null
  }

  /** Spec (repetition) 4.4: another rating for the card's latest review, rescheduled from the state before it. */
  rate(reviewId: number, rating: Rating): RepetitionInfo {
    const row = this.d.repo.review(reviewId)
    if (!row) throw new CardError('review_not_found')
    const card = this.d.repo.card(row.cardId)
    if (!card || card.deleted) throw new CardError('card_not_found')
    if (this.d.repo.latestReviewId(card.id) !== row.id) throw new CardError('not_latest')
    const state = schedule(row.stateBefore, rating, new Date(row.reviewedAt))
    this.d.repo.transaction(() => {
      this.d.repo.updateState(card.id, state)
      this.d.repo.setRating(row.id, rating)
    })
    return this.info({ ...row, rating }, { ...card, state })
  }

  /** Spec (repetition) 5.2: a position card whose start is no longer on the list: kept and listed, but never served or counted. */
  private orphan(c: CardRow): boolean {
    return c.kind === 'position' && !this.d.starts.isListed(startIdOf(c))
  }

  /** The cards the queue, the summary and the tree work with, by due time. */
  private servable(): CardRow[] {
    return this.d.repo.cards().filter((c) => !this.orphan(c))
  }

  /**
   * The queue's entries of `cards`, by due: without weights for the player's level the cards in the repo's order; with them
   * (part 3 spec 6.2, 6.4) the problems and the graph items instead of the position cards, in queueOrder.
   */
  private entries(cards: CardRow[]): Entry[] {
    const items = this.d.graphQueue?.() ?? null
    if (!items) return cards.map(cardEntry)
    return [...cards.filter((c) => c.kind === 'move').map(cardEntry), ...items.map(itemEntry)].sort(queueOrder)
  }

  /** Spec (repetition) 5.1 over the queue's entries: with weights a graph item counts as a position (part 3 spec 6.2). */
  summary(): CardSummary {
    const now = this.now()
    const entries = this.entries(this.servable())
    const due = (e: Entry): Date => new Date(e.due)
    const dueNow = entries.filter((e) => due(e) <= now)
    const today = dayStart(now)
    const forecast = Array.from({ length: 7 }, (_, d) => entries.filter((e) => (d === 0 ? due(e) < addDays(today, 1) : due(e) >= addDays(today, d) && due(e) < addDays(today, d + 1))).length)
    return {
      dueNow: dueNow.length,
      dueByKind: { position: dueNow.filter((e) => e.kind === 'position').length, move: dueNow.filter((e) => e.kind === 'move').length },
      forecast,
      total: entries.length,
      learned: entries.filter((e) => e.stage === 'learned').length,
      nextDue: dueNow.length > 0 || entries.length === 0 ? null : entries[0].due,
    }
  }

  /** The tab's list: every card, orphans included; with weights the problems and the graph items (part 3 spec 6.2). */
  list(kind?: CardKind): CardListItem[] {
    const moves = new Map(this.d.starts.list().map((e) => [e.id, e.moves]))
    return this.entries(this.d.repo.cards())
      .filter((e) => !kind || e.kind === kind)
      .map((e): CardListItem => {
        if (e.item !== null) {
          const { listId, color } = e.item
          return { id: e.id, kind: 'position', startId: listId, moves: e.item.moves, due: e.due, stage: e.stage, lastRating: null, reps: 0, orphan: false, problem: null, graph: { color } }
        }
        const c = e.card
        const startId = c.kind === 'position' ? startIdOf(c) : null
        const p = c.kind === 'move' ? (c.data as unknown as ProblemData) : null
        return {
          id: c.id, kind: c.kind, startId, moves: (startId && moves.get(startId)) || [], due: e.due, stage: e.stage,
          lastRating: this.d.repo.lastRating(c.id), reps: c.state.reps, orphan: this.orphan(c),
          problem: p && { source: p.source, group: p.group, moveNumber: p.moveNumber, ...zoneStones(p.moves, p.corner) },
        }
      })
  }

  /**
   * Spec (repetition) 5.2: the most overdue card, a position or a problem; when none is due, the earliest one in its learning
   * steps due within LEARN_AHEAD_MS (so a card rated «Снова» comes back in the same session); otherwise the next due time.
   * Part 3 spec 6.2: with weights the same over the problems and the graph items (queueOrder); an item is served as its
   * list position and colour.
   */
  due(): DueCard {
    const now = this.now().getTime()
    const entries = this.entries(this.servable())
    const dueAt = (e: Entry): number => new Date(e.due).getTime()
    const next = entries.find((e) => dueAt(e) <= now) ?? entries.find((e) => e.learning && dueAt(e) <= now + LEARN_AHEAD_MS)
    if (!next) return { card: null, nextDue: entries[0]?.due ?? null }
    if (next.item !== null) return { card: { id: next.id, kind: 'graph', startId: next.item.listId, userColor: next.item.color } }
    const card = next.card
    if (card.kind === 'move') {
      const p = card.data as unknown as ProblemData
      return { card: { id: card.id, kind: 'move', problem: { source: p.source, corner: p.corner, userColor: p.userColor, moves: p.moves, userMove: p.userMove, userLoss: p.userLoss, moveNumber: p.moveNumber, group: p.group } } }
    }
    const data = card.data as unknown as PositionData
    return { card: { id: card.id, kind: 'position', startId: data.startId, userColor: data.userColor, botRank: data.botRank } }
  }

  /** Spec (repetition) 5.4: judge a problem answer and record it as the card's review. */
  async answer(cardId: string, vertex: Vertex): Promise<ProblemAnswer> {
    const card = this.d.repo.card(cardId)
    if (!card || card.deleted) throw new CardError('card_not_found')
    if (card.kind !== 'move') throw new CardError('wrong_kind')
    const p = card.data as unknown as ProblemData
    if (!Position.fromMoves(p.moves).isLegal(p.toMove, vertex)) throw new CardError('illegal_move')
    const judge = this.d.judge
    let judged = candidateLoss(p, vertex)
    // Black's lead after an answer outside the candidates, as the engine measured it.
    let measured: number | null = null
    if (!judged) {
      if (!judge || !judge.ready()) throw new CardError('engine_unavailable')
      try {
        const after = await judge.analyze({ ...baseQuery([...p.moves, { color: p.toMove, vertex }]), maxVisits: judge.visits(), priority: 10 })
        measured = after.rootInfo.scoreLead
        judged = { loss: lossAfter(p, measured), best: false }
      } catch (err) {
        if (err instanceof EngineError) throw new CardError('engine_unavailable')
        throw err
      }
    }
    const { loss, best } = judged
    const thresholds = judge?.thresholds() ?? DEFAULT_CONFIG.thresholds
    const category = categorize(loss, thresholds)
    const raw: MoveRaw = { loss, best }
    const auto = moveRating(raw, thresholds)
    const now = this.now()
    // The card is read again after the await: a concurrent answer may have moved its state.
    const fresh = this.d.repo.card(cardId)
    if (!fresh || fresh.deleted) throw new CardError('card_not_found')
    const stateBefore = fresh.state
    const state = schedule(stateBefore, auto, now)
    const reviewId = this.d.repo.transaction(() => {
      this.d.repo.updateState(cardId, state)
      return this.d.repo.insertReview({ cardId, reviewedAt: now.toISOString(), rating: auto, auto, worst: category === 'exact' ? null : { category, loss }, stateBefore, sessionId: null, raw })
    })
    const row = this.d.repo.review(reviewId)!
    return {
      vertex, loss, category, best, line: p.analysis.candidates[0],
      position: { turn: 0, scoreLeadBlack: p.analysis.scoreLeadBlack, visits: p.analysis.visits, candidates: p.analysis.candidates, ownership: null },
      leadAfter: measured ?? p.analysis.scoreLeadBlack - colorSign(p.toMove) * loss,
      repetition: this.info(row, { ...fresh, state }),
    }
  }

  /**
   * Spec (progress part 2) 5: every card again at `thresholds` (the new level's), in one transaction: each review's auto
   * rating and worst move derived anew (replayedPosition, replayedProblem; a manual rating stays), the FSRS history
   * replayed from the card's creation, with the state before each review that `rate` starts from; only what changed is
   * written. `reviewOf` rebuilds a training's review at `thresholds` from the database, null when the training is gone. A
   * training it fails on is logged and falls back to its stored worst move, so that one unreadable old training cannot
   * block every level change.
   */
  replayLevel(thresholds: Thresholds, reviewOf: (sessionId: string) => ReviewData | null = () => null): void {
    const rebuilt = (sessionId: string): ReviewData | null => {
      try {
        return reviewOf(sessionId)
      } catch (err) {
        this.d.log?.(`level replay: training ${sessionId} not rebuilt, its stored worst move is used: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    }
    this.d.repo.transaction(() => {
      for (const card of this.d.repo.cards()) {
        const rows = this.d.repo.reviewsOf(card.id)
        const derived = rows.map((r) => (card.kind === 'position' ? replayedPosition(r, thresholds, rebuilt) : replayedProblem(r, thresholds)))
        const replayed = rows.map((r, i) => ({ reviewedAt: r.reviewedAt, manual: r.manual ? r.rating : null, auto: derived[i].auto }))
        const { state, before } = replayCard(replayed, (r) => r.auto, card.createdAt)
        rows.forEach((r, i) => {
          const next = { ...derived[i], rating: r.manual ? r.rating : derived[i].auto, stateBefore: before[i] }
          const unchanged = next.rating === r.rating && next.auto === r.auto && same(next.worst, r.worst) && same(next.stateBefore, r.stateBefore) && same(next.raw, r.raw)
          if (!unchanged) this.d.repo.replaceReview(r.id, next)
        })
        if (!same(state, card.state)) this.d.repo.updateState(card.id, state)
      }
    })
  }

  /** Spec (problem variations) 3.1: the moves and the side to move of a problem card; null for anything else. */
  problemBase(cardId: string): { moves: Move[]; toMove: Color } | null {
    const card = this.d.repo.card(cardId)
    if (!card || card.deleted || card.kind !== 'move') return null
    const p = card.data as unknown as ProblemData
    return { moves: p.moves, toMove: p.toMove }
  }

  /** A graph item (part 3 spec 6.2) is no card: card_not_found. */
  remove(id: string): void {
    const card = this.d.repo.card(id)
    if (!card || card.deleted) throw new CardError('card_not_found')
    this.d.repo.markDeleted(id)
  }

  /** Spec (repetition) 6: the state of every position card, by start id. */
  startStates(): Record<string, StartCardState> {
    const now = this.now()
    const out: Record<string, StartCardState> = {}
    for (const c of this.servable()) {
      if (c.kind !== 'position') continue
      out[startIdOf(c)] = { stage: stageOf(c.state), due: c.state.due, dueNow: new Date(c.state.due) <= now }
    }
    return out
  }
}
