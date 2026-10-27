import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { newState, recall, schedule, type FsrsState } from '../cards/schedule'
import type { NodeCards } from '../progress/compute'
import { moveNeeds } from './need'

const NOW = new Date('2026-10-22T10:00:00.000Z')

describe('moveNeeds', () => {
  it('is 1 without a card and for one never reviewed, else 1 minus the probability of recall', () => {
    const reviewedAt = new Date('2026-10-12T10:00:00.000Z')
    const reviewed = schedule(newState(reviewedAt), 'good', reviewedAt)
    const never: FsrsState = { ...newState(NOW), state: State.Review, reps: 1, stability: 5 }
    const cards: NodeCards = { move: [null, reviewed, never], rest: [reviewed, null, null] }
    const need = 1 - recall(reviewed, NOW)
    expect(need).toBeGreaterThan(0)
    expect(need).toBeLessThan(1)
    expect(moveNeeds(cards, NOW)).toEqual(Float64Array.of(1, need, 1))
  })
})
