import { describe, expect, it } from 'vitest'
import { SessionFollow } from './session-follow'

describe('SessionFollow', () => {
  it('shows every session the user has not left', () => {
    const f = new SessionFollow()
    expect([f.acceptState('a'), f.acceptState('a'), f.concerns('a')]).toEqual([true, true, true])
  })

  it('keeps a session left for the start screen off the screen, whatever comes late', () => {
    const f = new SessionFollow()
    f.acceptState('a')
    f.leave('a')
    expect([f.acceptState('a'), f.concerns('a')]).toEqual([false, false])
    // The next training from the start screen shows as usual.
    f.starting(null)
    expect([f.acceptState('b'), f.concerns('b')]).toEqual([true, true])
  })

  it('retires the old session with the first state of the new one, not before', () => {
    const f = new SessionFollow()
    f.acceptState('a')
    f.starting('a')
    // A late state of the old session while the new one is on its way still updates the screen.
    expect(f.acceptState('a')).toBe(true)
    expect(f.acceptState('b')).toBe(true)
    expect([f.acceptState('a'), f.concerns('a'), f.concerns('b')]).toEqual([false, false, true])
  })

  it('keeps following the old session when the start fails', () => {
    const f = new SessionFollow()
    f.acceptState('a')
    f.starting('a')
    expect([f.acceptState('a'), f.concerns('a')]).toEqual([true, true])
  })
})
