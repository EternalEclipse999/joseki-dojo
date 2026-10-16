import { randomUUID } from 'node:crypto'
import type { CardKind, CardListItem, CardSummary, DueCard, Rating, RepetitionInfo, ReviewData, StartCardState } from '@joseki-dojo/shared'
import type { StartBook } from '../starts/book'
import type { SessionRecord } from '../store/records'
import { positionRating } from './grade'
import type { CardRepo, CardRow, ReviewRow } from './repo'
import { dayStart, inLearningSteps, newState, schedule, stageOf } from './schedule'

export class CardError extends Error {
  constructor(readonly code: 'card_not_found' | 'review_not_found' | 'not_latest') {
    super(code)
  }
}

export interface CardServiceDeps {
  repo: CardRepo
  starts: StartBook
  now?: () => Date
  newId?: () => string
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

/** Spec (repetition) 4–5: cards, their schedule and the queue. Iteration 1: position cards. */
export class CardService {
  constructor(private readonly d: CardServiceDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date()
  }

  /** Spec (repetition) 4.2: a finished training of a listed start is a repetition of its position card. */
  recordTraining(rec: SessionRecord, review: ReviewData): void {
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

  private info(row: ReviewRow, card: CardRow): RepetitionInfo {
    return { cardId: card.id, reviewId: row.id, auto: row.auto, rating: row.rating, worst: row.worst, editable: this.d.repo.latestReviewId(card.id) === row.id, due: card.state.due }
  }

  /** Spec (repetition) 5.3: the repetition shown over the review of `sessionId`. */
  repetitionOf(sessionId: string): RepetitionInfo | null {
    const row = this.d.repo.reviewOfSession(sessionId)
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
        return {
          id: c.id, kind: c.kind, startId, moves: (startId && moves.get(startId)) || [], due: c.state.due, stage: stageOf(c.state),
          lastRating: this.d.repo.lastRating(c.id), reps: c.state.reps, orphan: this.orphan(c),
        }
      })
  }

  /**
   * Spec (repetition) 5.2: the most overdue position card; when none is due, the earliest one in its learning steps due
   * within LEARN_AHEAD_MS (so a card rated «Снова» comes back in the same session); otherwise the next due time.
   */
  due(): DueCard {
    const now = this.now().getTime()
    // Only position cards are served by the queue in this iteration (iteration 2 adds move cards).
    const cards = this.servable().filter((c) => c.kind === 'position')
    const dueAt = (c: CardRow): number => new Date(c.state.due).getTime()
    const next = cards.find((c) => dueAt(c) <= now) ?? cards.find((c) => inLearningSteps(c.state) && dueAt(c) <= now + LEARN_AHEAD_MS)
    if (!next) return { card: null, nextDue: cards[0]?.state.due ?? null }
    const data = next.data as unknown as PositionData
    return { card: { id: next.id, kind: 'position', startId: data.startId, userColor: data.userColor, botRank: data.botRank } }
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
