import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, inZone, Position, zoneVertices, type ServerMessage, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { isHumanQuery, isPassProbe, isTenukiQuery, StubEngine, testConfig } from '../../test/helpers'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import type { AppConfig } from '../config'
import { EngineError } from '../engine/engine'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { SessionService } from './service'
import { SessionError } from './session'

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({
  mode: 'free',
  environment: 'empty',
  userColor: 'B',
  botRank: '7k',
  corner: 'TR',
  ...over,
})

function setup(config: Partial<AppConfig> = {}, repo = new SessionRepo(openDb(':memory:')), engine = new StubEngine()) {
  const cfg = testConfig(config)
  const published: { id: string; msg: ServerMessage }[] = []
  const finished: string[] = []
  let n = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    publish: (id, msg) => published.push({ id, msg }),
    onFinished: (id) => finished.push(id),
    rng: mulberry32(7),
    newId: () => `s${++n}`,
    now: () => '2026-10-06T10:00:00.000Z',
  })
  const errors = (): ServerMessage[] => published.filter((p) => p.msg.type === 'error').map((p) => p.msg)
  return { service, engine, repo, published, finished, errors }
}

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: string }).code ?? 'no-code'
  }
  return null
}

/** A free, legal point of the TR zone in the current position. */
const freeZonePoint = (v: SessionView): Vertex => {
  const p = Position.fromMoves([...v.initialMoves, ...v.moves])
  const found = zoneVertices('TR').find((x) => p.colorAt(x) === null && p.isLegal(v.toMove, x))
  if (!found) throw new Error('zone is full')
  return found
}

describe('SessionService', () => {
  it('starts a session and analyses the empty position', async () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    expect(v).toMatchObject({ id: 's1', toMove: 'B', status: 'playing', botThinking: false, josekiStarted: false })
    await vi.waitFor(() => expect(engine.queries.some((q) => q.includeOwnership === true && q.moves.length === 0)).toBe(true))
  })

  it('resolves a random color and corner', () => {
    const v = setup().service.start(settings({ userColor: 'random', corner: 'random' }))
    expect(['B', 'W']).toContain(v.settings.userColor)
    expect(['TL', 'TR', 'BL', 'BR']).toContain(v.settings.corner)
  })

  it('rejects invalid settings', () => {
    const { service } = setup()
    expect(() => service.start(settings({ botRank: '99k' }))).toThrow(SessionError)
  })

  it('lets the bot open when the user plays White', async () => {
    const { service } = setup()
    const v = service.start(settings({ userColor: 'W' }))
    expect(v.botThinking).toBe(true)
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(1))
    expect(service.view(v.id).moves[0]).toMatchObject({ color: 'B', actor: 'bot', inZone: true })
  })

  it('answers a user move with a bot move in the zone', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    expect(service.view(v.id).moves[1]).toMatchObject({ color: 'W', actor: 'bot', inZone: true })
  })

  it('rejects moves outside the zone and out of turn', () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    expect(codeOf(() => service.playUserMove(v.id, [3, 15]))).toBe('outside_zone')
    engine.hold = true
    service.playUserMove(v.id, [15, 3])
    expect(codeOf(() => service.playUserMove(v.id, [16, 3]))).toBe('not_your_turn')
    engine.release()
  })

  it('proposes the end when both analyses point outside the zone', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
    expect(service.view(v.id).moves).toHaveLength(2)
  })

  it('does not propose the end while the best move stays in the zone', async () => {
    const { service, engine } = setup()
    engine.best = (q) => (isTenukiQuery(q) ? q.allowMoves![0].moves[0] : 'R17')
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(engine.queries.some(isPassProbe)).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(service.view(v.id).endProposed).toBe(false)
  })

  it('proposes again only two moves after «Играть дальше»', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
    service.continuePlaying(v.id)
    expect(service.view(v.id).endProposed).toBe(false)
    service.playUserMove(v.id, freeZonePoint(service.view(v.id)))
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(4))
    await vi.waitFor(() => expect(service.view(v.id).endProposed).toBe(true))
  })

  it('finishes on request, once', () => {
    const { service, repo, finished } = setup()
    const v = service.start(settings())
    service.finish(v.id)
    service.finish(v.id)
    expect(service.view(v.id).status).toBe('finished')
    expect(repo.getSession(v.id)?.status).toBe('finished')
    expect(finished).toEqual([v.id])
  })

  it('finishes automatically at the move limit', async () => {
    const { service, finished } = setup({ maxSessionMoves: 2 })
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).status).toBe('finished'))
    expect(service.view(v.id).moves).toHaveLength(2)
    expect(finished).toEqual([v.id])
  })

  it('plays tenuki for the user at the best point outside the zone', async () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    await service.tenuki(v.id)
    const q = engine.queries.find(isTenukiQuery)!
    expect(q.allowMoves![0].player).toBe('B')
    expect(q.allowMoves![0].moves.every((m) => !inZone('TR', gtpToVertex(m)))).toBe(true)
    expect(service.view(v.id).moves[0]).toMatchObject({ actor: 'auto-tenuki', inZone: false, vertex: gtpToVertex(q.allowMoves![0].moves[0]) })
  })

  it('reports a failed bot move and retries it on resync', async () => {
    const { service, engine, errors } = setup()
    engine.fail = { when: isHumanQuery, error: new EngineError('boom', 'query_error') }
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(errors()).toEqual([{ type: 'error', code: 'engine_error', message: 'boom' }]))
    expect(service.view(v.id).botThinking).toBe(false)
    expect(service.view(v.id).moves).toHaveLength(1)
    service.resync(v.id)
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
  })

  it('restores sessions from the database', async () => {
    const repo = new SessionRepo(openDb(':memory:'))
    const first = setup({}, repo)
    const v = first.service.start(settings())
    first.service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(first.service.view(v.id).moves).toHaveLength(2))
    const second = setup({}, repo)
    expect(second.service.resync(v.id).moves).toEqual(first.service.view(v.id).moves)
  })

  it('replays from a chosen move', async () => {
    const { service } = setup()
    const v = service.start(settings())
    service.playUserMove(v.id, [15, 3])
    await vi.waitFor(() => expect(service.view(v.id).moves).toHaveLength(2))
    const r = service.replayFrom(v.id, 1)
    expect(r).toMatchObject({ parentSessionId: v.id, initialMoves: [{ color: 'B', vertex: [15, 3] }], moves: [], toMove: 'W' })
    await vi.waitFor(() => expect(service.view(r.id).moves).toHaveLength(1))
    expect(() => service.replayFrom(v.id, 5)).toThrow(SessionError)
  })

  it('restarts the review on resync of a finished session without a summary', () => {
    const { service, finished } = setup()
    const v = service.start(settings())
    service.finish(v.id)
    service.resync(v.id)
    expect(finished).toEqual([v.id, v.id])
  })
})
