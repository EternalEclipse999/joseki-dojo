import type { CardKind, Rating, RepetitionInfo } from '@joseki-dojo/shared'
import type { MoveRaw } from '../progress/repo'
import { statements, type Db, type Statement } from '../store/db'
import type { PositionRaw } from './grade'
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
  /** The player chose `rating` (CardService.rate); a level-change replay keeps it. */
  manual: boolean
  worst: RepetitionInfo['worst']
  stateBefore: FsrsState
  sessionId: string | null
  /**
   * Spec (progress part 2) 5: what a rating at another level needs — PositionRaw for a position review, MoveRaw for a
   * problem answer; null for the review of a training that made or repeated a problem, and for older reviews.
   */
  raw: PositionRaw | MoveRaw | null
}

interface RawCard { id: string; kind: CardKind; card_key: string; data_json: string; fsrs_json: string; created_at: string; deleted: number }
interface RawReview { id: number; card_id: string; reviewed_at: string; rating: Rating; auto_rating: Rating; manual: number; worst_json: string | null; state_before_json: string; session_id: string | null; raw_json: string | null }

const card = (r: RawCard): CardRow => ({ id: r.id, kind: r.kind, key: r.card_key, data: JSON.parse(r.data_json), state: JSON.parse(r.fsrs_json), createdAt: r.created_at, deleted: r.deleted === 1 })
const review = (r: RawReview): ReviewRow => ({
  id: r.id, cardId: r.card_id, reviewedAt: r.reviewed_at, rating: r.rating, auto: r.auto_rating, manual: r.manual === 1,
  worst: r.worst_json ? JSON.parse(r.worst_json) : null, stateBefore: JSON.parse(r.state_before_json), sessionId: r.session_id, raw: r.raw_json ? JSON.parse(r.raw_json) : null,
})
const json = (v: unknown): string | null => (v ? JSON.stringify(v) : null)

/** Spec (repetition) 4.5: the `cards` and `card_reviews` tables. */
export class CardRepo {
  private readonly sql: (text: string) => Statement

  constructor(private readonly db: Db) {
    this.sql = statements(db)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  insertCard(c: Omit<CardRow, 'deleted'>): void {
    this.sql('INSERT INTO cards (id, kind, card_key, data_json, fsrs_json, due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, c.kind, c.key, JSON.stringify(c.data), JSON.stringify(c.state), c.state.due, c.createdAt)
  }

  card(id: string): CardRow | null {
    const r = this.sql('SELECT * FROM cards WHERE id = ?').get(id) as RawCard | undefined
    return r ? card(r) : null
  }

  cardByKey(key: string): CardRow | null {
    const r = this.sql('SELECT * FROM cards WHERE card_key = ?').get(key) as RawCard | undefined
    return r ? card(r) : null
  }

  /** The cards not deleted, by due time. */
  cards(): CardRow[] {
    return (this.sql('SELECT * FROM cards WHERE deleted = 0 ORDER BY due, id').all() as RawCard[]).map(card)
  }

  updateState(id: string, state: FsrsState): void {
    this.sql('UPDATE cards SET fsrs_json = ?, due = ? WHERE id = ?').run(JSON.stringify(state), state.due, id)
  }

  markDeleted(id: string): void {
    this.sql('UPDATE cards SET deleted = 1 WHERE id = ?').run(id)
  }

  /** A review the player has not rated yet. */
  insertReview(r: Omit<ReviewRow, 'id' | 'manual'>): number {
    const info = this.sql('INSERT INTO card_reviews (card_id, reviewed_at, rating, auto_rating, worst_json, state_before_json, session_id, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.cardId, r.reviewedAt, r.rating, r.auto, json(r.worst), JSON.stringify(r.stateBefore), r.sessionId, json(r.raw))
    return Number(info.lastInsertRowid)
  }

  review(id: number): ReviewRow | null {
    const r = this.sql('SELECT * FROM card_reviews WHERE id = ?').get(id) as RawReview | undefined
    return r ? review(r) : null
  }

  /** The reviews of a card, oldest first. */
  reviewsOf(cardId: string): ReviewRow[] {
    return (this.sql('SELECT * FROM card_reviews WHERE card_id = ? ORDER BY id').all(cardId) as RawReview[]).map(review)
  }

  reviewBySession(cardId: string, sessionId: string): ReviewRow | null {
    const r = this.sql('SELECT * FROM card_reviews WHERE card_id = ? AND session_id = ?').get(cardId, sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  /** Spec (repetition) 5.3: the latest review of a training that belongs to a position card (problem reviews of the same training are not it). */
  positionReviewOfSession(sessionId: string): ReviewRow | null {
    const r = this.sql("SELECT r.* FROM card_reviews r JOIN cards c ON c.id = r.card_id WHERE r.session_id = ? AND c.kind = 'position' ORDER BY r.id DESC LIMIT 1")
      .get(sessionId) as RawReview | undefined
    return r ? review(r) : null
  }

  latestReviewId(cardId: string): number | null {
    const r = this.sql('SELECT MAX(id) AS id FROM card_reviews WHERE card_id = ?').get(cardId) as { id: number | null }
    return r.id
  }

  lastRating(cardId: string): Rating | null {
    const r = this.sql('SELECT rating FROM card_reviews WHERE card_id = ? ORDER BY id DESC LIMIT 1').get(cardId) as { rating: Rating } | undefined
    return r?.rating ?? null
  }

  /** The player's own rating of a review. */
  setRating(id: number, rating: Rating): void {
    this.sql('UPDATE card_reviews SET rating = ?, manual = 1 WHERE id = ?').run(rating, id)
  }

  /** Spec (progress part 2) 5: what a level-change replay derives anew for a review; its manual mark stays. */
  replaceReview(id: number, r: Pick<ReviewRow, 'rating' | 'auto' | 'worst' | 'stateBefore' | 'raw'>): void {
    this.sql('UPDATE card_reviews SET rating = ?, auto_rating = ?, worst_json = ?, state_before_json = ?, raw_json = ? WHERE id = ?')
      .run(r.rating, r.auto, json(r.worst), JSON.stringify(r.stateBefore), json(r.raw), id)
  }
}
