import { describe, expect, it } from 'vitest'
import { newState, schedule } from '../cards/schedule'
import { openDb } from '../store/db'
import { GraphCardRepo, type GraphCard, type GraphReview } from './repo'

const now = new Date('2026-10-21T10:00:00')
const card = (over: Partial<GraphCard> = {}): GraphCard => ({ key: 'B:0', kind: 'move', color: 'B', state: newState(now), createdAt: now.toISOString(), ...over })
const review = (over: Partial<Omit<GraphReview, 'id'>> = {}): Omit<GraphReview, 'id'> => ({
  cardKey: 'B:0', kind: 'move', color: 'B', reviewedAt: now.toISOString(), sessionId: 's1', manual: null, auto: 'good', raw: { loss: 0.2, best: false }, ...over,
})

describe('GraphCardRepo', () => {
  it('creates a card and updates its state, keeping its creation time', () => {
    const repo = new GraphCardRepo(openDb(':memory:'))
    expect(repo.card('B:0', 'move', 'B')).toBeNull()
    repo.upsert(card())
    const next = schedule(card().state, 'good', now)
    repo.upsert(card({ state: next, createdAt: '2026-10-22T10:00:00.000Z' }))
    expect(repo.card('B:0', 'move', 'B')).toEqual(card({ state: next }))
    expect(repo.allCards()).toEqual([card({ state: next })])
  })

  it('keeps the move card, the rest card and the other colour of a key apart', () => {
    const repo = new GraphCardRepo(openDb(':memory:'))
    repo.upsert(card())
    repo.upsert(card({ kind: 'rest' }))
    repo.upsert(card({ kind: 'rest', color: 'W' }))
    expect(repo.allCards().map((c) => [c.kind, c.color])).toEqual([['move', 'B'], ['rest', 'B'], ['rest', 'W']])
    expect(repo.card('B:0', 'move', 'W')).toBeNull()
  })

  it('records reviews with their raw data, one per card and training', () => {
    const repo = new GraphCardRepo(openDb(':memory:'))
    repo.upsert(card())
    repo.upsert(card({ kind: 'rest' }))
    const restRaw = { moves: [{ loss: 2.5, key: 'W:1', seenBefore: false }], opponent: [{ loss: 3, replyLoss: 1.5, key: 'B:2', seenBefore: true }] }
    const a = repo.insertReview(review())
    const b = repo.insertReview(review({ sessionId: 's2', manual: 'easy' }))
    const c = repo.insertReview(review({ kind: 'rest', auto: 'hard', raw: restRaw }))
    expect(repo.reviews('B:0', 'move', 'B')).toEqual([{ id: a, ...review() }, { id: b, ...review({ sessionId: 's2', manual: 'easy' }) }])
    expect(repo.allReviews()).toEqual([{ id: a, ...review() }, { id: b, ...review({ sessionId: 's2', manual: 'easy' }) }, { id: c, ...review({ kind: 'rest', auto: 'hard', raw: restRaw }) }])
    expect([repo.reviewed('B:0', 'move', 'B', 's1'), repo.reviewed('B:0', 'rest', 'B', 's2'), repo.reviewed('B:0', 'move', 'W', 's1')]).toEqual([true, false, false])
    expect(() => repo.insertReview(review())).toThrow()
    expect(() => repo.insertReview(review({ cardKey: 'W:9' }))).toThrow()
  })

  it('remembers when a position was first met', () => {
    const db = openDb(':memory:')
    const repo = new GraphCardRepo(db)
    expect(repo.seen('W:1')).toBe(false)
    repo.markSeen('W:1', '2026-10-21T10:00:00.000Z')
    repo.markSeen('W:1', '2026-10-22T10:00:00.000Z')
    expect([repo.seen('W:1'), repo.seen('W:2')]).toEqual([true, false])
    expect(db.prepare('SELECT key, first_at FROM graph_seen').all()).toEqual([{ key: 'W:1', first_at: '2026-10-21T10:00:00.000Z' }])
  })

  it('rolls a failed transaction back', () => {
    const repo = new GraphCardRepo(openDb(':memory:'))
    expect(() =>
      repo.transaction(() => {
        repo.upsert(card())
        repo.markSeen('W:1', now.toISOString())
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect([repo.allCards(), repo.seen('W:1')]).toEqual([[], false])
  })
})
