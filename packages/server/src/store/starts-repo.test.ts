import { describe, expect, it } from 'vitest'
import type { ResolvedSettings } from '@joseki-dojo/shared'
import { openDb } from './db'
import type { SessionRecord } from './records'
import { SessionRepo } from './repo'

const settings = (start?: ResolvedSettings['start']): ResolvedSettings => ({ mode: start ? 'list' : 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR', ...(start ? { start } : {}) })
const record = (id: string, start?: ResolvedSettings['start']): SessionRecord => ({
  id,
  createdAt: '2026-10-14T10:00:00.000Z',
  finishedAt: null,
  settings: settings(start),
  status: 'playing',
  parentSessionId: null,
  initialMoves: [],
  moves: [],
  summary: null,
})

describe('start positions in the repository', () => {
  it('keeps the start of a session', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record('a', { id: 'abcd1234', name: 'Имя', mirror: true }))
    repo.insertSession(record('b'))
    expect(repo.getSession('a')?.settings.start).toEqual({ id: 'abcd1234', name: 'Имя', mirror: true })
    expect(repo.getSession('b')?.settings.start).toBeUndefined()
  })

  it('counts only finished sessions as shows', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    repo.insertSession(record('a', { id: 'x', name: null, mirror: false }))
    repo.insertSession(record('b', { id: 'x', name: null, mirror: false }))
    repo.insertSession(record('c', { id: 'y', name: null, mirror: false }))
    repo.insertSession(record('d'))
    repo.setStatus('a', 'finished', '2026-10-14T10:05:00.000Z')
    repo.setStatus('c', 'abandoned', null)
    repo.setStatus('d', 'finished', '2026-10-14T10:05:00.000Z')
    expect(repo.startShows()).toEqual(new Map([['x', 1]]))
  })
})
