import type { Rating } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { newState, schedule } from '../cards/schedule'
import { replayCard } from './replay'

const at = (minutes: number): string => new Date(Date.parse('2026-10-21T10:00:00Z') + minutes * 60_000).toISOString()
const review = (minutes: number, auto: Rating, manual: Rating | null = null) => ({ reviewedAt: at(minutes), manual, auto })
const created = newState(new Date(at(0)))

describe('replayCard', () => {
  it('replays the history from a new card at its creation, each review at its time', () => {
    const first = schedule(created, 'good', new Date(at(0)))
    const second = schedule(first, 'hard', new Date(at(30)))
    expect(replayCard([review(0, 'good'), review(30, 'hard'), review(24 * 60, 'good')], (r) => r.auto, at(0))).toEqual({
      state: schedule(second, 'good', new Date(at(24 * 60))),
      autos: ['good', 'hard', 'good'],
      before: [created, first, second],
    })
  })

  it('derives every auto rating anew, and FSRS gets the manual rating where there is one', () => {
    const { state, autos } = replayCard([review(0, 'good'), review(30, 'good', 'easy')], () => 'again', at(0))
    expect(autos).toEqual(['again', 'again'])
    expect(state).toEqual(schedule(schedule(created, 'again', new Date(at(0))), 'easy', new Date(at(30))))
  })

  it('skips a review that is none at the level, its manual rating with it', () => {
    const reviews = [review(0, 'good'), review(30, 'hard', 'easy'), review(60, 'good')]
    const { state, autos, before } = replayCard(reviews, (r) => (r.reviewedAt === at(30) ? null : r.auto), at(0))
    const first = schedule(created, 'good', new Date(at(0)))
    expect(autos).toEqual(['good', null, 'good'])
    expect(before).toEqual([created, first, first])
    expect(state).toEqual(schedule(first, 'good', new Date(at(60))))
    // With no review left the card is as new.
    expect(replayCard([review(0, 'good')], () => null, at(0)).state).toEqual(created)
  })
})
