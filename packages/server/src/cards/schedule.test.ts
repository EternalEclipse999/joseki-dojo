import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { dayStart, newState, recall, schedule, stageOf } from './schedule'

const at = (iso: string): Date => new Date(iso)

describe('the FSRS schedule', () => {
  it('starts a card as due now and learning', () => {
    const s = newState(at('2026-10-15T10:00:00'))
    expect(new Date(s.due).getTime()).toBe(at('2026-10-15T10:00:00').getTime())
    expect(stageOf(s)).toBe('learning')
  })

  it('brings an «again» back within minutes and a «good» later', () => {
    const now = at('2026-10-15T10:00:00')
    const again = schedule(newState(now), 'again', now)
    const good = schedule(newState(now), 'good', now)
    expect(new Date(again.due).getTime() - now.getTime()).toBeLessThanOrEqual(10 * 60_000)
    expect(new Date(good.due).getTime()).toBeGreaterThan(new Date(again.due).getTime())
  })

  it('moves a card to the review stage after good answers spaced by their due times', () => {
    let s = newState(at('2026-10-15T10:00:00'))
    for (let i = 0; i < 4 && stageOf(s) === 'learning'; i++) s = schedule(s, 'good', new Date(s.due))
    expect(stageOf(s)).toBe('learned')
    expect(s.reps).toBeGreaterThanOrEqual(2)
  })

  it('round-trips through JSON', () => {
    const s = schedule(newState(at('2026-10-15T10:00:00')), 'hard', at('2026-10-15T10:00:00'))
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it("gives the probability of recall: 0 for a new card, 1 just after a review, the request retention at a review card's due", () => {
    const now = at('2026-10-15T10:00:00')
    expect(recall(newState(now), now)).toBe(0)
    expect(recall(schedule(newState(now), 'good', now), now)).toBe(1)
    // Good answers at their due times: learning, then the review stage twice (the second interval close to its stability).
    let s = newState(now)
    for (let i = 0; i < 3; i++) s = schedule(s, 'good', new Date(s.due))
    expect(stageOf(s)).toBe('learned')
    expect(Math.abs(recall(s, new Date(s.due)) - 0.9)).toBeLessThan(0.005)
  })

  it('gives 0 for a card that is not new but was never reviewed', () => {
    const now = at('2026-10-15T10:00:00')
    expect(recall({ ...newState(now), state: State.Review, reps: 1, stability: 5 }, now)).toBe(0)
  })

  it('starts the day at 04:00 local time', () => {
    expect(dayStart(at('2026-10-15T03:59:00'))).toEqual(at('2026-10-14T04:00:00'))
    expect(dayStart(at('2026-10-15T04:00:00'))).toEqual(at('2026-10-15T04:00:00'))
    expect(dayStart(at('2026-10-15T23:30:00'))).toEqual(at('2026-10-15T04:00:00'))
  })
})
