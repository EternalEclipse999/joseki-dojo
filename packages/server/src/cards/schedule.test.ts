import { describe, expect, it } from 'vitest'
import { dayStart, newState, schedule, stageOf } from './schedule'

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

  it('starts the day at 04:00 local time', () => {
    expect(dayStart(at('2026-10-15T03:59:00'))).toEqual(at('2026-10-14T04:00:00'))
    expect(dayStart(at('2026-10-15T04:00:00'))).toEqual(at('2026-10-15T04:00:00'))
    expect(dayStart(at('2026-10-15T23:30:00'))).toEqual(at('2026-10-15T04:00:00'))
  })
})
