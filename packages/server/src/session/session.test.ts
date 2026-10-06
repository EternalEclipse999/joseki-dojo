import { describe, expect, it } from 'vitest'
import { IllegalMoveError } from '@joseki-dojo/shared'
import type { SessionRecord } from '../store/records'
import { Session, SessionError } from './session'

const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-10-06T10:00:00.000Z',
  finishedAt: null,
  settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
  ...over,
})

describe('Session', () => {
  it('alternates colors starting with Black', () => {
    const s = new Session(rec())
    expect(s.toMove).toBe('B')
    expect(s.isUserTurn).toBe(true)
    const played = s.apply([15, 3], 'user')
    expect(played).toEqual({ color: 'B', vertex: [15, 3], actor: 'user', inZone: true })
    expect(s.toMove).toBe('W')
    expect(s.isUserTurn).toBe(false)
    expect(s.turn).toBe(1)
  })

  it('continues after initial moves', () => {
    const s = new Session(rec({ initialMoves: [{ color: 'B', vertex: [15, 3] }] }))
    expect(s.toMove).toBe('W')
    expect(s.turn).toBe(0)
    expect(s.allMoves).toEqual([{ color: 'B', vertex: [15, 3] }])
  })

  it('starts the joseki once both colors are in the zone', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    s.apply([3, 15], 'bot')
    expect(s.josekiStarted).toBe(false)
    s.apply([2, 3], 'user')
    s.apply([16, 5], 'bot')
    expect(s.josekiStarted).toBe(true)
  })

  it('rejects illegal moves without changing state', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    expect(() => s.apply([15, 3], 'bot')).toThrow(IllegalMoveError)
    expect(s.turn).toBe(1)
    expect(s.toMove).toBe('W')
  })

  it('refuses moves after finishing', () => {
    const s = new Session(rec())
    s.finish('2026-10-06T10:05:00.000Z')
    expect(s.record.finishedAt).toBe('2026-10-06T10:05:00.000Z')
    expect(() => s.apply([15, 3], 'user')).toThrow(SessionError)
  })

  it('re-proposes the end only after two more moves', () => {
    const s = new Session(rec())
    expect(s.canProposeEnd()).toBe(false)
    s.apply([15, 3], 'user')
    s.apply([16, 5], 'bot')
    expect(s.canProposeEnd()).toBe(true)
    s.proposeEnd()
    expect(s.view().endProposed).toBe(true)
    expect(s.canProposeEnd()).toBe(false)
    s.declineEnd()
    expect(s.view().endProposed).toBe(false)
    expect(s.canProposeEnd()).toBe(false)
    s.apply([14, 5], 'user')
    expect(s.canProposeEnd()).toBe(false)
    s.apply([16, 6], 'bot')
    expect(s.canProposeEnd()).toBe(true)
  })

  it('treats playing on as declining the proposal', () => {
    const s = new Session(rec())
    s.apply([15, 3], 'user')
    s.apply([16, 5], 'bot')
    s.proposeEnd()
    s.apply([14, 5], 'user')
    expect(s.view().endProposed).toBe(false)
    expect(s.canProposeEnd()).toBe(false)
    s.apply([16, 6], 'bot')
    expect(s.canProposeEnd()).toBe(true)
  })

  it('rebuilds its state from a stored record', () => {
    const s = new Session(
      rec({
        moves: [
          { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
          { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
        ],
      }),
    )
    expect(s.turn).toBe(2)
    expect(s.toMove).toBe('B')
    expect(s.josekiStarted).toBe(true)
    expect(s.position.colorAt([16, 5])).toBe('W')
  })

  it('exposes a view', () => {
    const s = new Session(rec())
    s.botThinking = true
    expect(s.view()).toEqual({
      id: 's1',
      settings: rec().settings,
      initialMoves: [],
      moves: [],
      toMove: 'B',
      status: 'playing',
      josekiStarted: false,
      endProposed: false,
      botThinking: true,
      parentSessionId: null,
    })
  })
})
