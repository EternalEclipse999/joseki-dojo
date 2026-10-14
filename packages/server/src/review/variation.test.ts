import { describe, expect, it, vi } from 'vitest'
import { moveToGtp, type ServerMessage } from '@joseki-dojo/shared'
import { EngineError } from '../engine/engine'
import { StubEngine, testConfig } from '../../test/helpers'
import { SessionError } from '../session/session'
import { openDb } from '../store/db'
import type { SessionRecord } from '../store/records'
import { SessionRepo } from '../store/repo'
import { VariationService } from './variation'

function setup() {
  const engine = new StubEngine()
  const repo = new SessionRepo(openDb(':memory:'))
  const config = testConfig()
  const rec: SessionRecord = {
    id: 's1',
    createdAt: '2026-10-06T10:00:00.000Z',
    finishedAt: '2026-10-06T10:05:00.000Z',
    settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' },
    status: 'finished',
    parentSessionId: null,
    initialMoves: [],
    moves: [
      { color: 'B', vertex: [15, 3], actor: 'user', inZone: true },
      { color: 'W', vertex: [16, 5], actor: 'bot', inZone: true },
      { color: 'B', vertex: [14, 5], actor: 'user', inZone: true },
    ],
    summary: null,
  }
  repo.insertSession(rec)
  engine.best = () => 'D4'
  const service = new VariationService({ repo, engine, config })
  const limit = config.analysis.variationVisits
  /** `onFirst` runs synchronously inside the first message, before the stub's next timer tick. */
  const inbox = (onFirst?: () => void): { msgs: ServerMessage[]; send: (m: ServerMessage) => void } => {
    const msgs: ServerMessage[] = []
    return {
      msgs,
      send: (m) => {
        msgs.push(m)
        if (msgs.length === 1) onFirst?.()
      },
    }
  }
  return { engine, service, limit, inbox, repo }
}

type Analysis = Extract<ServerMessage, { type: 'variationAnalysis' }>
const isAnalysis = (m: ServerMessage): m is Analysis => m.type === 'variationAnalysis'
const finished = (msgs: ServerMessage[]): boolean => msgs.some((m) => isAnalysis(m) && m.done)
const REQ = { sessionId: 's1', fromTurn: 1, moves: [[3, 3], [15, 15]] as [number, number][] }

describe('VariationService', () => {
  it('sends partial results, then one done result at the visits limit', async () => {
    const { service, limit, inbox } = setup()
    const { msgs, send } = inbox()
    service.start({}, REQ, send)
    await vi.waitFor(() => expect(finished(msgs)).toBe(true))
    const got = msgs.filter(isAnalysis)
    expect(got.map((m) => m.done)).toEqual([false, false, true])
    expect(got.map((m) => m.visits)).toEqual([Math.ceil(limit / 4), Math.ceil(limit / 2), limit])
    const last = got[2]
    expect(last.position.turn).toBe(REQ.fromTurn + REQ.moves.length)
    expect(last.fromTurn).toBe(1)
    expect(last.moves).toEqual(REQ.moves)
    expect(last.position.candidates).toEqual([{ vertex: [3, 15], loss: 0, pv: [[3, 15]] }])
    expect(last.position.ownership).toHaveLength(361)
  })

  it('queries the moves before fromTurn plus the variation, with ownership', async () => {
    const { service, limit, inbox, engine } = setup()
    const { msgs, send } = inbox()
    service.start({}, REQ, send)
    await vi.waitFor(() => expect(finished(msgs)).toBe(true))
    const q = engine.queries[0]
    expect(q.moves).toEqual([
      ['B', moveToGtp([15, 3])],
      ['W', moveToGtp([3, 3])],
      ['B', moveToGtp([15, 15])],
    ])
    expect(q.maxVisits).toBe(limit)
    expect(q.includeOwnership).toBe(true)
  })

  it('rejects an illegal variation, an unknown session and a bad fromTurn', () => {
    const { service, inbox } = setup()
    const { send } = inbox()
    expect(() => service.start({}, { sessionId: 's1', fromTurn: 0, moves: [[3, 3], [3, 3]] }, send)).toThrow(expect.objectContaining({ text: { key: 'error.variation.illegal' } }))
    expect(() => service.start({}, { sessionId: 'nope', fromTurn: 0, moves: [] }, send)).toThrow(SessionError)
    expect(() => service.start({}, { sessionId: 's1', fromTurn: 4, moves: [] }, send)).toThrow(SessionError)
    expect(() => service.start({}, { sessionId: 's1', fromTurn: -1, moves: [] }, send)).toThrow(SessionError)
  })

  it('refuses a session that is not finished', () => {
    const { service, inbox, repo } = setup()
    repo.insertSession({ ...repo.getSession('s1')!, id: 's2', status: 'playing', finishedAt: null })
    expect(() => service.start({}, { sessionId: 's2', fromTurn: 0, moves: [] }, inbox().send)).toThrow(expect.objectContaining({ text: { key: 'error.variation.reviewOnly' } }))
  })

  it('a malformed request leaves the previous stream of the owner running', async () => {
    const { service, inbox, engine } = setup()
    const owner = {}
    const { msgs, send } = inbox()
    service.start(owner, REQ, send)
    expect(() => service.start(owner, { sessionId: 's1', fromTurn: 0, moves: [[3, 3], [3, 3]] }, send)).toThrow(SessionError)
    expect(() => service.start(owner, { sessionId: 'nope', fromTurn: 0, moves: [] }, send)).toThrow(SessionError)
    expect(engine.stops).toBe(0)
    await vi.waitFor(() => expect(finished(msgs)).toBe(true))
  })

  it('a new start for the same owner stops the previous stream and silences it', async () => {
    const { service, inbox, engine } = setup()
    const owner = {}
    const { msgs, send } = inbox(() => service.start(owner, { sessionId: 's1', fromTurn: 0, moves: [[9, 9]] }, send2))
    const send2 = (m: ServerMessage): void => send(m)
    service.start(owner, { sessionId: 's1', fromTurn: 0, moves: [[3, 3]] }, send)
    await vi.waitFor(() => expect(finished(msgs)).toBe(true))
    expect(engine.stops).toBe(1)
    const after = msgs.slice(1).filter(isAnalysis)
    expect(after.every((m) => m.moves[0][0] === 9)).toBe(true)
    expect(msgs.filter(isAnalysis).filter((m) => m.done)).toHaveLength(1)
  })

  it('stop(owner) stops the stream and no done message follows', async () => {
    const { service, inbox, engine } = setup()
    const owner = {}
    const { msgs, send } = inbox(() => service.stop(owner))
    service.start(owner, REQ, send)
    await vi.waitFor(() => expect(msgs.length).toBeGreaterThan(0))
    expect(engine.stops).toBe(1)
    const count = msgs.length
    await new Promise((r) => setTimeout(r, 20))
    expect(msgs).toHaveLength(count)
    expect(finished(msgs)).toBe(false)
    service.stop(owner)
    expect(engine.stops).toBe(1)
  })

  it('answers a fully analysed position from the cache without a new query', async () => {
    const { service, limit, inbox, engine } = setup()
    const first = inbox()
    service.start({}, REQ, first.send)
    await vi.waitFor(() => expect(finished(first.msgs)).toBe(true))
    const second = inbox()
    service.start({}, REQ, second.send)
    expect(second.msgs).toHaveLength(1)
    expect(second.msgs[0]).toMatchObject({ type: 'variationAnalysis', done: true, visits: limit })
    expect(engine.queries).toHaveLength(1)
  })

  it('sends a cached partial result first and replaces it only with more visits', async () => {
    const { service, limit, inbox, engine } = setup()
    const owner = {}
    const first = inbox(() => service.stop(owner))
    service.start(owner, REQ, first.send)
    await vi.waitFor(() => expect(first.msgs.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    const cachedVisits = Math.ceil(limit / 4)
    expect(first.msgs[0]).toMatchObject({ visits: cachedVisits })
    const second = inbox()
    service.start(owner, REQ, second.send)
    expect(second.msgs[0]).toMatchObject({ done: false, visits: cachedVisits })
    await vi.waitFor(() => expect(finished(second.msgs)).toBe(true))
    expect(engine.queries).toHaveLength(2)
    expect(second.msgs.filter(isAnalysis).map((m) => m.visits)).toEqual([cachedVisits, Math.ceil(limit / 2), limit])
  })

  it('asks again once by itself after a restart, without an error for the client', async () => {
    const { service, inbox, engine } = setup()
    engine.streamFailures.push(new EngineError({ key: 'error.engine.restarted' }, 'engine_failed'))
    const { msgs, send } = inbox()
    service.start({}, REQ, send)
    await vi.waitFor(() => expect(finished(msgs)).toBe(true))
    expect(msgs.some((m) => m.type === 'error')).toBe(false)
    expect(engine.queries).toHaveLength(2)
    expect(engine.queries[1].moves).toEqual(engine.queries[0].moves)
  })

  it('sends the error when the second ask fails too, or when the engine has failed for good', async () => {
    const { service, inbox, engine } = setup()
    engine.streamFailures.push(new EngineError({ key: 'error.engine.restarted' }, 'engine_failed'), new EngineError({ key: 'error.engine.restarted' }, 'engine_failed'))
    const twice = inbox()
    service.start({}, REQ, twice.send)
    await vi.waitFor(() => expect(twice.msgs).toHaveLength(1))
    expect(twice.msgs[0]).toMatchObject({ type: 'error', code: 'engine_error' })
    expect(engine.queries).toHaveLength(2)

    engine.failed = true
    engine.streamFailures.push(new EngineError({ key: 'error.engine.crashed', params: { count: 4, detail: 'exit code 1' } }, 'engine_failed'))
    const forGood = inbox()
    service.start({}, { ...REQ, moves: [[9, 9]] }, forGood.send)
    await vi.waitFor(() => expect(forGood.msgs).toHaveLength(1))
    expect(forGood.msgs[0]).toMatchObject({ type: 'error' })
    expect(engine.queries).toHaveLength(3)
  })

  it('does not ask again after a query error', async () => {
    const { service, inbox, engine } = setup()
    engine.streamFailures.push(new EngineError({ key: 'error.engine.query', params: { detail: 'bad' } }, 'query_error'))
    const { msgs, send } = inbox()
    service.start({}, REQ, send)
    await vi.waitFor(() => expect(msgs).toHaveLength(1))
    expect(engine.queries).toHaveLength(1)
  })

  it('forgets cached results on clear()', async () => {
    const { service, inbox, engine } = setup()
    const first = inbox()
    service.start({}, REQ, first.send)
    await vi.waitFor(() => expect(finished(first.msgs)).toBe(true))
    service.clear()
    const second = inbox()
    service.start({}, REQ, second.send)
    await vi.waitFor(() => expect(finished(second.msgs)).toBe(true))
    expect(engine.queries).toHaveLength(2)
  })

  it('searches again a position that was only stopped, even with the limit reached by a partial', async () => {
    const { service, inbox, engine } = setup()
    const owner = {}
    const first = inbox(() => service.stop(owner))
    service.start(owner, REQ, first.send)
    await vi.waitFor(() => expect(first.msgs.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    service.start(owner, REQ, inbox().send)
    expect(engine.queries).toHaveLength(2)
  })

  it('runs two owners independently', async () => {
    const { service, inbox, engine } = setup()
    const a = inbox()
    const b = inbox()
    service.start({}, { sessionId: 's1', fromTurn: 0, moves: [[3, 3]] }, a.send)
    service.start({}, { sessionId: 's1', fromTurn: 0, moves: [[9, 9]] }, b.send)
    await vi.waitFor(() => expect(finished(a.msgs) && finished(b.msgs)).toBe(true))
    expect(engine.stops).toBe(0)
    expect(a.msgs.filter(isAnalysis).every((m) => m.moves[0][0] === 3)).toBe(true)
    expect(b.msgs.filter(isAnalysis).every((m) => m.moves[0][0] === 9)).toBe(true)
  })
})
