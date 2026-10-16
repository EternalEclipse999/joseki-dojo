import { randomUUID } from 'node:crypto'
import { colorSign, Position, type CardKind, type CardListItem, type CardSummary, type Color, type DueCard, type Move, type ProblemAnswer, type Rating, type RepetitionInfo, type ReviewData, type StartCardState, type Vertex } from '@joseki-dojo/shared'
import { DEFAULT_CONFIG, type Thresholds } from '../config'
import { EngineError } from '../engine/engine'
import type { AnalysisResponse, KataGoQueryBody } from '../engine/katago-types'
import { baseQuery } from '../engine/query'
import { categorize } from '../review/compute'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { positionRating } from './grade'
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
}

interface PositionData {
  startId: string
  userColor: 'B' | 'W'
  botRank: string
}

/** Spec (repetition) 5.2: when nothing is due, the queue serves a card in its learning steps due this soon (as Anki does). */
export const LEARN_AHEAD_MS = 20 * 60_000

const startIdOf = (c: CardRow): string => String((c.data as Partial<PositionData>).startId ?? '')

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
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

  /** Spec (repetition) 4.2: a finished training of a listed start is a repetition of its position card. */
  private recordPosition(rec: SessionRecord, review: ReviewData): void {
    const start = rec.settings.start
    if (!start || start.dubious) return
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
      this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: auto.rating, auto: auto.rating, worst: auto.worst, stateBefore, sessionId: rec.id })
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
        this.d.repo.insertReview({ cardId: card.id, reviewedAt: now.toISOString(), rating: 'again', auto: 'again', worst: null, stateBefore, sessionId: rec.id })
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

  summary(): CardSummary {
    const now = this.now()
    const cards = this.servable()
    const due = (c: CardRow): Date => new Date(c.state.due)
    const dueNow = cards.filter((c) => due(c) <= now)
    const today = dayStart(now)
    const forecast = Array.from({ length: 7 }, (_, d) => cards.filter((c) => (d === 0 ? due(c) < addDays(today, 1) : due(c) >= addDays(today, d) && due(c) < addDays(today, d + 1))).length)
    return {
      dueNow: dueNow.length,
      dueByKind: { position: dueNow.filter((c) => c.kind === 'position').length, move: dueNow.filter((c) => c.kind === 'move').length },
      forecast,
      total: cards.length,
      learned: cards.filter((c) => stageOf(c.state) === 'learned').length,
      nextDue: dueNow.length > 0 || cards.length === 0 ? null : cards[0].state.due,
    }
  }

  list(kind?: CardKind): CardListItem[] {
    const moves = new Map(this.d.starts.list().map((e) => [e.id, e.moves]))
    return this.d.repo
      .cards()
      .filter((c) => !kind || c.kind === kind)
      .map((c) => {
        const startId = c.kind === 'position' ? startIdOf(c) : null
        const p = c.kind === 'move' ? (c.data as unknown as ProblemData) : null
        return {
          id: c.id, kind: c.kind, startId, moves: (startId && moves.get(startId)) || [], due: c.state.due, stage: stageOf(c.state),
          lastRating: this.d.repo.lastRating(c.id), reps: c.state.reps, orphan: this.orphan(c),
          problem: p && { source: p.source, group: p.group, moveNumber: p.moveNumber, ...zoneStones(p.moves, p.corner) },
        }
      })
  }

  /**
   * Spec (repetition) 5.2: the most overdue card, a position or a problem; when none is due, the earliest one in its learning
   * steps due within LEARN_AHEAD_MS (so a card rated «Снова» comes back in the same session); otherwise the next due time.
   */
  due(): DueCard {
    const now = this.now().getTime()
    const cards = this.servable()
    const dueAt = (c: CardRow): number => new Date(c.state.due).getTime()
    const next = cards.find((c) => dueAt(c) <= now) ?? cards.find((c) => inLearningSteps(c.state) && dueAt(c) <= now + LEARN_AHEAD_MS)
    if (!next) return { card: null, nextDue: cards[0]?.state.due ?? null }
    if (next.kind === 'move') {
      const p = next.data as unknown as ProblemData
      return { card: { id: next.id, kind: 'move', problem: { source: p.source, corner: p.corner, userColor: p.userColor, moves: p.moves, userMove: p.userMove, userLoss: p.userLoss, moveNumber: p.moveNumber, group: p.group } } }
    }
    const data = next.data as unknown as PositionData
    return { card: { id: next.id, kind: 'position', startId: data.startId, userColor: data.userColor, botRank: data.botRank } }
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
    const category = categorize(loss, judge?.thresholds() ?? DEFAULT_CONFIG.thresholds)
    const auto: Rating = best ? 'easy' : category === 'exact' ? 'good' : category === 'inaccuracy' ? 'hard' : 'again'
    const now = this.now()
    // The card is read again after the await: a concurrent answer may have moved its state.
    const fresh = this.d.repo.card(cardId)
    if (!fresh || fresh.deleted) throw new CardError('card_not_found')
    const stateBefore = fresh.state
    const state = schedule(stateBefore, auto, now)
    const reviewId = this.d.repo.transaction(() => {
      this.d.repo.updateState(cardId, state)
      return this.d.repo.insertReview({ cardId, reviewedAt: now.toISOString(), rating: auto, auto, worst: category === 'exact' ? null : { category, loss }, stateBefore, sessionId: null })
    })
    const row = this.d.repo.review(reviewId)!
    return {
      vertex, loss, category, best, line: p.analysis.candidates[0],
      position: { turn: 0, scoreLeadBlack: p.analysis.scoreLeadBlack, visits: p.analysis.visits, candidates: p.analysis.candidates, ownership: null },
      leadAfter: measured ?? p.analysis.scoreLeadBlack - colorSign(p.toMove) * loss,
      repetition: this.info(row, { ...fresh, state }),
    }
  }

  /** Spec (problem variations) 3.1: the moves and the side to move of a problem card; null for anything else. */
  problemBase(cardId: string): { moves: Move[]; toMove: Color } | null {
    const card = this.d.repo.card(cardId)
    if (!card || card.deleted || card.kind !== 'move') return null
    const p = card.data as unknown as ProblemData
    return { moves: p.moves, toMove: p.toMove }
  }

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
