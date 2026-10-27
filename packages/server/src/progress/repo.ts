import type { Color, ProgressDelta, Rating } from '@joseki-dojo/shared'
import type { FsrsState } from '../cards/schedule'
import type { ZoneMove } from '../graph/key'
import { statements, type Db, type Statement } from '../store/db'

/** Spec (progress part 2) 2.1: a move card (a node where the player's colour moves) or a rest card (a node and the player's colour). */
export type GraphCardKind = 'move' | 'rest'

export interface GraphCard {
  /** The node's position key (graph/key.ts), never its index: the indices change when the graph is rebuilt. */
  key: string
  kind: GraphCardKind
  /** The player's colour. */
  color: Color
  state: FsrsState
  createdAt: string
}

/** Spec 2.4: a move card review — the player's loss and whether the move was KataGo's best. */
export type MoveRaw = {
  loss: number
  best: boolean
  /** Part 3 spec 4: the move in the node's orientation; absent in older reviews. */
  move?: ZoneMove
}
/**
 * Spec 2.4: a rest card review, complete for a rating at any level (the level-change replay picks the mistakes and judges
 * whether they were punished again):
 * - `moves`: every in-zone move of the player after the move that left the graph, with its loss;
 * - `opponent`: every in-zone move of the opponent from the leaving move on that the player answered, mistake or not, with
 *   its loss and the loss of the player's reply.
 * Each has the key of the player's decision position — the position before the player's move, or after the opponent's
 * move with the player to answer it — and whether the player had met that position before. The keys are in the graph's
 * colours (roles: Black started the corner).
 */
export type RestRaw = {
  moves: { loss: number; key: string; seenBefore: boolean }[]
  opponent: { loss: number; replyLoss: number; key: string; seenBefore: boolean }[]
}

export interface GraphReview {
  id: number
  cardKey: string
  kind: GraphCardKind
  color: Color
  reviewedAt: string
  sessionId: string
  /** The player's own rating; null until the player changes it. */
  manual: Rating | null
  auto: Rating
  /** MoveRaw for a move card, RestRaw for a rest card. */
  raw: MoveRaw | RestRaw
}

interface RawCard { key: string; kind: GraphCardKind; color: Color; fsrs_json: string; created_at: string }
interface RawReview { id: number; card_key: string; kind: GraphCardKind; color: Color; reviewed_at: string; session_id: string; manual: Rating | null; auto: Rating; raw_json: string }
interface RawDelta { list_id: string | null; color: Color; before: number; after: number; new_moves: number }

const card = (r: RawCard): GraphCard => ({ key: r.key, kind: r.kind, color: r.color, state: JSON.parse(r.fsrs_json), createdAt: r.created_at })
const review = (r: RawReview): GraphReview => ({
  id: r.id, cardKey: r.card_key, kind: r.kind, color: r.color, reviewedAt: r.reviewed_at, sessionId: r.session_id, manual: r.manual, auto: r.auto, raw: JSON.parse(r.raw_json),
})

/** Spec (progress part 2) 2.2: the `graph_cards`, `graph_reviews` and `graph_seen` tables; part 3 spec 7: `graph_training_progress`. */
export class GraphCardRepo {
  private readonly sql: (text: string) => Statement

  constructor(private readonly db: Db) {
    this.sql = statements(db)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  card(key: string, kind: GraphCardKind, color: Color): GraphCard | null {
    const r = this.sql('SELECT * FROM graph_cards WHERE key = ? AND kind = ? AND color = ?').get(key, kind, color) as RawCard | undefined
    return r ? card(r) : null
  }

  /** Inserts the card, or replaces the state of the stored one (its creation time stays). */
  upsert(c: GraphCard): void {
    this.sql(
      `INSERT INTO graph_cards (key, kind, color, fsrs_json, due, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key, kind, color) DO UPDATE SET fsrs_json = excluded.fsrs_json, due = excluded.due`,
    ).run(c.key, c.kind, c.color, JSON.stringify(c.state), c.state.due, c.createdAt)
  }

  /** Every card, in the order they were created. */
  allCards(): GraphCard[] {
    return (this.sql('SELECT * FROM graph_cards ORDER BY rowid').all() as RawCard[]).map(card)
  }

  /** Throws for a card that is not stored and for a second review of a card in one training. */
  insertReview(r: Omit<GraphReview, 'id'>): number {
    const info = this.sql('INSERT INTO graph_reviews (card_key, kind, color, reviewed_at, session_id, manual, auto, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.cardKey, r.kind, r.color, r.reviewedAt, r.sessionId, r.manual, r.auto, JSON.stringify(r.raw))
    return Number(info.lastInsertRowid)
  }

  /** The reviews of a card, oldest first. */
  reviews(key: string, kind: GraphCardKind, color: Color): GraphReview[] {
    return (this.sql('SELECT * FROM graph_reviews WHERE card_key = ? AND kind = ? AND color = ? ORDER BY id').all(key, kind, color) as RawReview[]).map(review)
  }

  /** Every review, oldest first. */
  allReviews(): GraphReview[] {
    return (this.sql('SELECT * FROM graph_reviews ORDER BY id').all() as RawReview[]).map(review)
  }

  /** Spec 5: the auto rating a level-change replay derived anew. */
  setAuto(id: number, auto: Rating): void {
    this.sql('UPDATE graph_reviews SET auto = ? WHERE id = ?').run(auto, id)
  }

  /** The card has a review of the training `sessionId`. */
  reviewed(key: string, kind: GraphCardKind, color: Color, sessionId: string): boolean {
    return this.sql('SELECT 1 FROM graph_reviews WHERE card_key = ? AND kind = ? AND color = ? AND session_id = ?').get(key, kind, color, sessionId) !== undefined
  }

  /** Spec 3.3: the position `key` was met outside the graph; the first time is kept. */
  markSeen(key: string, at: string): void {
    this.sql('INSERT OR IGNORE INTO graph_seen (key, first_at) VALUES (?, ?)').run(key, at)
  }

  seen(key: string): boolean {
    return this.sql('SELECT 1 FROM graph_seen WHERE key = ?').get(key) !== undefined
  }

  /** Part 3 spec 7: the progress the training `sessionId` gained; the first one stored for a training stays. */
  insertDelta(sessionId: string, d: ProgressDelta): void {
    this.sql('INSERT OR IGNORE INTO graph_training_progress (session_id, list_id, color, before, after, new_moves) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, d.listId, d.color, d.before, d.after, d.newPositions)
  }

  delta(sessionId: string): ProgressDelta | null {
    const r = this.sql('SELECT * FROM graph_training_progress WHERE session_id = ?').get(sessionId) as RawDelta | undefined
    return r ? { listId: r.list_id, color: r.color, before: r.before, after: r.after, newPositions: r.new_moves } : null
  }
}
