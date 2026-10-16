import type { CardKind, Rating, RepetitionInfo } from '@joseki-dojo/shared'
import type { Db } from '../store/db'
import type { FsrsState } from './schedule'

export interface CardRow {
  id: string
  kind: CardKind
  key: string
  data: Record<string, unknown>
  state: FsrsState
  createdAt: string
  deleted: boolean
}

export interface ReviewRow {
  id: number
  cardId: string
  reviewedAt: string
  rating: Rating
  auto: Rating
  worst: RepetitionInfo['worst']
  stateBefore: FsrsState
  sessionId: string | null
}

interface RawCard { id: string; kind: CardKind; card_key: string; data_json: string; fsrs_json: string; created_at: string; deleted: number }
interface RawReview { id: number; card_id: string; reviewed_at: string; rating: Rating; auto_rating: Rating; worst_json: string | null; state_before_json: string; session_id: string | null }

const card = (r: RawCard): CardRow => ({ id: r.id, kind: r.kind, key: r.card_key, data: JSON.parse(r.data_json), state: JSON.parse(r.fsrs_json), createdAt: r.created_at, deleted: r.deleted === 1 })
const review = (r: RawReview): ReviewRow => ({
  id: r.id, cardId: r.card_id, reviewedAt: r.reviewed_at, rating: r.rating, auto: r.auto_rating,
  worst: r.worst_json ? JSON.parse(r.worst_json) : null, stateBefore: JSON.parse(r.state_before_json), sessionId: r.session_id,
})

/** Spec (repetition) 4.5: the `cards` and `card_reviews` tables. */
export class CardRepo {
  constructor(private readonly db: Db) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  insertCard(c: Omit<CardRow, 'deleted'>): void {
    this.db
      .prepare('INSERT INTO cards (id, kind, card_key, data_json, fsrs_json, due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, c.kind, c.key, JSON.stringify(c.data), JSON.stringify(c.state), c.state.due, c.createdAt)
  }

  card(id: string): CardRow | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as RawCard | undefined
    return r ? card(r) : null
  }

  cardByKey(key: string): CardRow | null {
    const r = this.db.prepare('SELECT * FROM cards WHERE card_key = ?').get(key) as RawCard | undefined
    return r ? card(r) : null
  }

  /** The cards not deleted, by due time. */
  cards(): CardRow[] {
    return (this.db.prepare('SELECT * FROM cards WHERE deleted = 0 ORDER BY due, id').all() as RawCard[]).map(card)
  }

  updateState(id: string, state: FsrsState): void {
    this.db.prepare('UPDATE cards SET fsrs_json = ?, due = ? WHERE id = ?').run(JSON.stringify(state), state.due, id)
  }

  markDeleted(id: string): void {
    this.db.prepare('UPDATE cards SET deleted = 1 WHERE id = ?').run(id)
  }

  insertReview(r: Omit<ReviewRow, 'id'>): number {
    const info = this.db
      .prepare('INSERT INTO card_reviews (card_id, reviewed_at, rating, auto_rating, worst_json, state_before_json, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.cardId, r.reviewedAt, r.rating, r.auto, r.worst ? JSON.stringify(r.worst) : null, JSON.stringify(r.stateBefore), r.sessionId)
    return Number(info.lastInsertRowid)
  }

  review(id: number): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE id = ?').get(id) as RawReview | undefined
    return r ? review(r) : null
  }

  reviewBySession(cardId: string, sessionId: string): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE card_id = ? AND session_id = ?').get(cardId, sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  /** The review of a training, whatever its card (a training repeats at most one position card). */
  reviewOfSession(sessionId: string): ReviewRow | null {
    const r = this.db.prepare('SELECT * FROM card_reviews WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  latestReviewId(cardId: string): number | null {
    const r = this.db.prepare('SELECT MAX(id) AS id FROM card_reviews WHERE card_id = ?').get(cardId) as { id: number | null }
    return r.id
  }

  lastRating(cardId: string): Rating | null {
    const r = this.db.prepare('SELECT rating FROM card_reviews WHERE card_id = ? ORDER BY id DESC LIMIT 1').get(cardId) as { rating: Rating } | undefined
    return r?.rating ?? null
  }

  setRating(id: number, rating: Rating): void {
    this.db.prepare('UPDATE card_reviews SET rating = ? WHERE id = ?').run(rating, id)
  }
}
