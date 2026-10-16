import { describe, expect, it } from 'vitest'
import { openDb } from '../store/db'
import { CardRepo } from './repo'
import { newState, schedule } from './schedule'

const now = new Date('2026-10-15T10:00:00')

describe('CardRepo', () => {
  it('inserts a card, finds it by key, updates its state and lists it', () => {
    const repo = new CardRepo(openDb(':memory:'))
    const state = newState(now)
    repo.insertCard({ id: 'c1', kind: 'position', key: 'position:abcd1234', data: { startId: 'abcd1234', userColor: 'B', botRank: '7k' }, state, createdAt: now.toISOString() })
    expect(repo.cardByKey('position:abcd1234')?.id).toBe('c1')
    const next = schedule(state, 'good', now)
    repo.updateState('c1', next)
    expect(repo.card('c1')?.state).toEqual(next)
    expect(repo.cards().map((c) => c.id)).toEqual(['c1'])
  })

  it('records reviews, knows the latest and replaces a rating', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k', data: {}, state: newState(now), createdAt: now.toISOString() })
    const r1 = repo.insertReview({ cardId: 'c1', reviewedAt: now.toISOString(), rating: 'good', auto: 'good', worst: null, stateBefore: newState(now), sessionId: 's1' })
    const r2 = repo.insertReview({ cardId: 'c1', reviewedAt: now.toISOString(), rating: 'again', auto: 'again', worst: { category: 'mistake', loss: 2.5 }, stateBefore: newState(now), sessionId: 's2' })
    expect(repo.latestReviewId('c1')).toBe(r2)
    expect(repo.reviewBySession('c1', 's1')?.id).toBe(r1)
    repo.setRating(r2, 'hard')
    expect(repo.review(r2)?.rating).toBe('hard')
    expect(repo.lastRating('c1')).toBe('hard')
  })

  it('marks a card deleted: hidden from lists but its key stays taken', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k', data: {}, state: newState(now), createdAt: now.toISOString() })
    repo.markDeleted('c1')
    expect(repo.cards()).toEqual([])
    expect(repo.cardByKey('k')?.deleted).toBe(true)
  })

  it('rejects a duplicate (card, session) review but allows several without a session', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k', data: {}, state: newState(now), createdAt: now.toISOString() })
    const base = { cardId: 'c1', reviewedAt: now.toISOString(), rating: 'good' as const, auto: 'good' as const, worst: null, stateBefore: newState(now) }
    repo.insertReview({ ...base, sessionId: 's1' })
    expect(() => repo.insertReview({ ...base, sessionId: 's1' })).toThrow()
    repo.insertReview({ ...base, sessionId: null })
    repo.insertReview({ ...base, sessionId: null })
  })

  it('has the last rating of a card, and none without reviews', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'c1', kind: 'position', key: 'k1', data: {}, state: newState(now), createdAt: now.toISOString() })
    repo.insertCard({ id: 'c2', kind: 'position', key: 'k2', data: {}, state: newState(now), createdAt: now.toISOString() })
    const base = { reviewedAt: now.toISOString(), rating: 'good' as const, auto: 'good' as const, worst: null, stateBefore: newState(now) }
    repo.insertReview({ ...base, cardId: 'c1', sessionId: 's' })
    repo.insertReview({ ...base, cardId: 'c2', sessionId: 's' })
    expect(repo.lastRating('c1')).toBe('good')
    repo.insertCard({ id: 'c3', kind: 'position', key: 'k3', data: {}, state: newState(now), createdAt: now.toISOString() })
    expect(repo.lastRating('c3')).toBeNull()
  })

  it('finds the review of a session that belongs to a position card, even when a problem card was reviewed later', () => {
    const repo = new CardRepo(openDb(':memory:'))
    repo.insertCard({ id: 'p', kind: 'position', key: 'position:abcd1234', data: {}, state: newState(now), createdAt: now.toISOString() })
    repo.insertCard({ id: 'm', kind: 'move', key: 'move:B:0', data: {}, state: newState(now), createdAt: now.toISOString() })
    const base = { reviewedAt: now.toISOString(), rating: 'again' as const, auto: 'again' as const, worst: null, stateBefore: newState(now), sessionId: 's1' }
    const position = repo.insertReview({ ...base, cardId: 'p' })
    const problem = repo.insertReview({ ...base, cardId: 'm' })
    expect(problem).toBeGreaterThan(position)
    expect(repo.positionReviewOfSession('s1')?.id).toBe(position)
    expect(repo.positionReviewOfSession('nope')).toBeNull()
  })
})
