import type { SessionSettings, StartListEntry } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { nextSettings } from './next-settings'

const entry = (id: string, group: StartListEntry['group']): StartListEntry => ({ id, group, name: id, moves: [] })
const LIST = [entry('a', '3-4'), entry('b', '4-4'), entry('c', '3-4')]
const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({ mode: 'list', environment: 'empty', userColor: 'random', botRank: '7k', corner: 'random', startId: 'b', ...over })

describe('nextSettings', () => {
  it('keeps the settings of the other modes', () => {
    const free = settings({ mode: 'free', startId: undefined })
    expect(nextSettings(free, LIST)).toBe(free)
  })

  it('takes the next list position in screen order (4-4 first, then 3-4) and wraps around', () => {
    expect(nextSettings(settings({ startId: 'b' }), LIST).startId).toBe('a')
    expect(nextSettings(settings({ startId: 'a' }), LIST).startId).toBe('c')
    expect(nextSettings(settings({ startId: 'c' }), LIST).startId).toBe('b')
  })

  it('starts from the top when the position is no longer on the list, and keeps the rest of the settings', () => {
    const next = nextSettings(settings({ startId: 'gone' }), LIST)
    expect(next).toEqual(settings({ startId: 'b' }))
  })

  it('keeps the settings when the list is empty', () => {
    const s = settings()
    expect(nextSettings(s, [])).toBe(s)
  })
})
