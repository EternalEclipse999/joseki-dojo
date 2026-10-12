import { describe, expect, it, vi } from 'vitest'
import { gtpToVertex, Position, vertexToGtp, zoneVertices, type MoveVertex, type PlayedMove, type ServerMessage, type SessionSettings, type SessionView, type Vertex } from '@joseki-dojo/shared'
import { isHumanQuery, StubEngine, testConfig } from '../../test/helpers'
import type { AppConfig } from '../config'
import { AnalysisScheduler } from '../analysis/scheduler'
import { HumanBot } from '../bot/bot'
import { mulberry32 } from '../bot/rng'
import { decodeJdb, encodeJdb } from '../jdb'
import { trapReview } from '../review/trap'
import { openDb } from '../store/db'
import { SessionRepo } from '../store/repo'
import { TrapBook } from '../traps/book'
import { testTrapsTree } from '../traps/fixture'
import { SessionService } from './service'

const book = (): TrapBook => TrapBook.fromBase(decodeJdb(encodeJdb(testTrapsTree())))
const V = (gtp: string): Vertex => gtpToVertex(gtp) as Vertex

const settings = (over: Partial<SessionSettings> = {}): SessionSettings => ({
  mode: 'traps',
  environment: 'empty',
  userColor: 'W',
  botRank: '7k',
  corner: 'TR',
  ...over,
})

/** `draws` feed `pick` and the mirror coin: 0 picks the first trap (Q16 O17 O18), 0.9 means no mirror. */
function setup(traps: TrapBook = book(), draws: number[] = [0, 0.9], over: { db?: ReturnType<typeof openDb>; config?: Partial<AppConfig> } = {}) {
  const engine = new StubEngine()
  const db = over.db ?? openDb(':memory:')
  const repo = new SessionRepo(db)
  const logs: string[] = []
  const cfg = testConfig(over.config)
  const published: ServerMessage[] = []
  let n = 0
  let k = 0
  const service = new SessionService({
    repo,
    engine,
    config: cfg,
    analysis: new AnalysisScheduler(engine, repo, cfg.analysis),
    bot: new HumanBot(engine, mulberry32(1)),
    traps,
    log: (line) => logs.push(line),
    publish: (_id, msg) => published.push(msg),
    onFinished: () => undefined,
    rng: () => draws[k++ % draws.length],
    newId: () => `s${++n}`,
    now: () => '2026-10-12T10:00:00.000Z',
  })
  return { service, engine, repo, cfg, db, logs }
}

const freeZonePoint = (v: SessionView): Vertex => {
  const p = Position.fromMoves([...v.initialMoves, ...v.moves])
  const found = zoneVertices('TR').find((x) => p.colorAt(x) === null && p.isLegal(v.toMove, x))
  if (!found) throw new Error('zone is full')
  return found
}

const waitMoves = async (service: SessionService, id: string, count: number): Promise<SessionView> => {
  await vi.waitFor(() => {
    const v = service.view(id)
    expect(v.moves.length).toBe(count)
    expect(v.botThinking).toBe(false)
  })
  return service.view(id)
}

const strongQueries = (engine: StubEngine) => engine.queries.filter((q) => q.allowMoves !== undefined && q.includeOwnership !== true)

describe('traps sessions', () => {
  it('places the initial moves and plays the trick without asking KataGo', async () => {
    const { service, engine } = setup()
    const v = service.start(settings())
    expect(v.settings.trap).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), index: 2, mirror: false, swapColors: false })
    expect(v.initialMoves).toEqual([
      { color: 'B', vertex: V('Q16') },
      { color: 'W', vertex: V('O17') },
    ])
    expect(v.toMove).toBe('B')
    const after = await waitMoves(service, v.id, 1)
    expect(after.moves[0]).toMatchObject({ color: 'B', vertex: V('O18'), actor: 'bot' })
    expect(after.toMove).toBe('W')
    // Up to the user's first turn the engine saw only the two background position analyses (with ownership).
    expect(
      engine.queries.map((q) => ({
        moves: q.moves.map(([c, m]) => `${c}${m}`),
        ownership: q.includeOwnership,
        allowMoves: q.allowMoves,
        humanProfile: q.overrideSettings?.humanSLProfile,
      })),
    ).toEqual([
      { moves: ['BQ16', 'WO17'], ownership: true, allowMoves: undefined, humanProfile: undefined },
      { moves: ['BQ16', 'WO17', 'BO18'], ownership: true, allowMoves: undefined, humanProfile: undefined },
    ])
    expect(strongQueries(engine)).toEqual([])
    expect(engine.queries.filter(isHumanQuery)).toEqual([])
  })

  it('falls back to the usual bot when the book no longer knows the trap', async () => {
    const { service, engine, repo, logs } = setup(TrapBook.empty())
    repo.insertSession({
      id: 'old',
      createdAt: '2026-10-12T10:00:00.000Z',
      finishedAt: null,
      settings: { mode: 'traps', environment: 'empty', userColor: 'W', botRank: '7k', corner: 'TR', trap: { id: 'deadbeef', index: 2, mirror: false, swapColors: false } },
      status: 'playing',
      parentSessionId: null,
      initialMoves: [
        { color: 'B', vertex: V('Q16') },
        { color: 'W', vertex: V('O17') },
      ],
      moves: [],
      summary: null,
    })
    service.resync('old')
    let v = await waitMoves(service, 'old', 1)
    expect(v.moves[0]).toMatchObject({ color: 'B', actor: 'bot' })
    expect(engine.queries.filter(isHumanQuery)).toHaveLength(1)
    // Later moves, where the strong replies would be, are the usual bot's too.
    for (let reply = 1; reply <= 3; reply++) {
      service.playUserMove('old', freeZonePoint(v))
      v = await waitMoves(service, 'old', 1 + 2 * reply)
    }
    expect(strongQueries(engine)).toEqual([])
    expect(engine.queries.filter(isHumanQuery)).toHaveLength(4)
    expect(logs).toEqual(['Ловушка deadbeef не найдена в базе, бот играет как обычно'])
  })

  it('records a finished traps session as one attempt row with the trap id and the verdict', async () => {
    const { service, db } = setup()
    const id = service.start(settings()).id
    await waitMoves(service, id, 1)
    service.playUserMove(id, V('N18'))
    await waitMoves(service, id, 3)
    service.finish(id)
    const rows = db.prepare('SELECT session_id, trap_id, result FROM trap_attempts').all()
    expect(rows).toEqual([{ session_id: id, trap_id: service.view(id).settings.trap!.id, result: 'caught' }])
    expect(db.prepare('SELECT status FROM sessions WHERE id = ?').get(id)).toEqual({ status: 'finished' })
  })

  it('plays three strong zone replies, then the human policy', async () => {
    const { service, engine, cfg } = setup()
    const id = service.start(settings()).id
    let v = await waitMoves(service, id, 1)
    for (let reply = 1; reply <= 3; reply++) {
      service.playUserMove(id, reply === 1 ? V('P17') : freeZonePoint(v))
      v = await waitMoves(service, id, 1 + 2 * reply)
      const qs = strongQueries(engine)
      expect(qs).toHaveLength(reply)
      const q = qs[reply - 1]
      expect(q.maxVisits).toBe(cfg.analysis.reviewVisits)
      expect(q.priority).toBe(10)
      expect(q.allowMoves).toHaveLength(1)
      expect(q.allowMoves![0]).toMatchObject({ player: 'B', untilDepth: 1 })
      const pos = Position.fromMoves(v.initialMoves.concat(v.moves.slice(0, -1).map(({ color, vertex }) => ({ color, vertex }))))
      const legal = zoneVertices('TR').filter((x) => pos.colorAt(x) === null && pos.isLegal('B', x)).map(vertexToGtp)
      expect(q.allowMoves![0].moves).toEqual(legal)
      expect(v.moves.at(-1)).toMatchObject({ color: 'B', actor: 'bot' })
    }
    service.playUserMove(id, freeZonePoint(v))
    await waitMoves(service, id, 9)
    expect(strongQueries(engine)).toHaveLength(3)
    expect(engine.queries.filter(isHumanQuery)).toHaveLength(1)
  })

  it('replays before and after the trick keeping the trap', async () => {
    const { service, engine } = setup()
    const id = service.start(settings()).id
    await waitMoves(service, id, 1)
    service.playUserMove(id, V('P17'))
    await waitMoves(service, id, 3)
    const trap = service.view(id).settings.trap!

    const before = service.replayFrom(id, 0)
    expect(before.settings.trap).toEqual(trap)
    expect(before.initialMoves).toHaveLength(2)
    const b = await waitMoves(service, before.id, 1)
    expect(b.moves[0]).toMatchObject({ vertex: V('O18'), actor: 'bot' })

    const after = service.replayFrom(id, 1)
    expect(after.settings.trap).toEqual(trap)
    expect(after.initialMoves).toHaveLength(3)
    expect(after.toMove).toBe('W')

    const strongBefore = strongQueries(engine).length
    const answered = service.replayFrom(id, 2)
    expect(answered.toMove).toBe('B')
    await waitMoves(service, answered.id, 1)
    expect(strongQueries(engine)).toHaveLength(strongBefore + 1)
  })

  it('is unavailable without a base, while free mode still works', () => {
    const { service } = setup(TrapBook.empty())
    expect(() => service.start(settings())).toThrowError(expect.objectContaining({ code: 'bad_request', message: 'Ловушки недоступны: нет базы ловушек' }))
    expect(service.start(settings({ mode: 'free' })).settings.mode).toBe('free')
  })

  it('writes one attempt row for an answered trap, none otherwise', async () => {
    const { service, repo } = setup()
    const id = service.start(settings()).id
    await waitMoves(service, id, 1)
    service.finish(id)
    expect(repo.trapShows().size).toBe(0)

    const second = setup()
    const id2 = second.service.start(settings()).id
    await waitMoves(second.service, id2, 1)
    second.service.playUserMove(id2, V('N18'))
    await waitMoves(second.service, id2, 3)
    second.service.finish(id2)
    second.service.finish(id2)
    expect([...second.repo.trapShows().values()]).toEqual([1])
    const row = second.repo.getSession(id2)!.settings.trap!
    expect(second.repo.trapShows().get(row.id)).toBe(1)
  })
})

describe('traps sessions: colours, mirror, reload and the move cap', () => {
  it('plays the trick where place says and answers strongly when the user has the trick colour (BL corner, mirrored)', async () => {
    // Draws: the first trap, then 0.1: the mirror coin comes up true.
    const { service, engine, db } = setup(book(), [0, 0.1])
    const v = service.start(settings({ userColor: 'B', corner: 'BL' }))
    const trap = v.settings.trap!
    expect(trap).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), index: 2, mirror: true, swapColors: true })
    // Stored Q16 O17 O18, mirrored in the diagonal and put in the bottom-left corner; the colours are swapped.
    expect(v.initialMoves).toEqual([
      { color: 'W', vertex: [3, 15] },
      { color: 'B', vertex: [2, 13] },
    ])
    expect(v.toMove).toBe('W')
    const after = await waitMoves(service, v.id, 1)
    expect(after.moves[0]).toMatchObject({ color: 'W', vertex: [1, 13], actor: 'bot' })
    expect(strongQueries(engine)).toEqual([])

    // The canonical answer P17 is [16, 4] mirrored and [2, 14] in the corner.
    service.playUserMove(v.id, [2, 14])
    const replied = await waitMoves(service, v.id, 3)
    expect(replied.moves[2]).toMatchObject({ color: 'W', actor: 'bot' })
    const qs = strongQueries(engine)
    expect(qs).toHaveLength(1)
    expect(qs[0].allowMoves).toHaveLength(1)
    expect(qs[0].allowMoves![0]).toMatchObject({ player: 'W', untilDepth: 1 })
    const zone = new Set(zoneVertices('BL').map(vertexToGtp))
    expect(qs[0].allowMoves![0].moves.length).toBeGreaterThan(0)
    expect(qs[0].allowMoves![0].moves.every((m) => zone.has(m))).toBe(true)
    service.finish(v.id)
    expect(db.prepare('SELECT trap_id, result FROM trap_attempts').all()).toEqual([{ trap_id: trap.id, result: 'correct' }])
  })

  it('answers strongly after a reload: a fresh service on the same database resumes at index + 2', async () => {
    const first = setup()
    const id = first.service.start(settings()).id
    await waitMoves(first.service, id, 1)
    first.engine.hold = true // the strong reply never arrives: the process "dies" here
    first.service.playUserMove(id, V('P17'))
    expect(first.repo.getSession(id)!.moves).toHaveLength(2)

    const second = setup(book(), [0, 0.9], { db: first.db })
    const v = second.service.resync(id)
    expect(v.settings.trap!.index).toBe(2)
    const resumed = await waitMoves(second.service, id, 3)
    expect(resumed.moves[2]).toMatchObject({ color: 'B', actor: 'bot' })
    const qs = strongQueries(second.engine)
    expect(qs).toHaveLength(1)
    expect(qs[0].allowMoves![0]).toMatchObject({ player: 'B', untilDepth: 1 })
    const zone = new Set(zoneVertices('TR').map(vertexToGtp))
    expect(qs[0].allowMoves![0].moves.every((m) => zone.has(m))).toBe(true)
    expect(second.engine.queries.filter(isHumanQuery)).toEqual([])
  })

  it('writes the attempt row when the move cap ends the session', async () => {
    const { service, db } = setup(book(), [0, 0.9], { config: { maxSessionMoves: 2 } })
    const id = service.start(settings()).id
    await waitMoves(service, id, 1)
    service.playUserMove(id, V('N18')) // the answer is the 2nd move: the cap finishes the session
    expect(service.view(id).status).toBe('finished')
    expect(db.prepare('SELECT session_id, trap_id, result FROM trap_attempts').all()).toEqual([
      { session_id: id, trap_id: service.view(id).settings.trap!.id, result: 'caught' },
    ])
  })
})

describe('trapReview', () => {
  const played = (color: 'B' | 'W', gtp: string, actor: 'user' | 'bot'): PlayedMove => ({ color, vertex: V(gtp), actor, inZone: true })
  const base = { mode: 'traps' as const, environment: 'empty' as const, userColor: 'W' as const, botRank: '7k', corner: 'TR' as const }
  const b = book()
  const id = b.ids()[0]
  const trap = { id, index: 2, mirror: false, swapColors: false }
  const settingsOf = { ...base, trap }
  const trick = played('B', 'O18', 'bot')

  it('judges the answer', () => {
    for (const [answer, verdict] of [['P17', 'correct'], ['N18', 'caught'], ['R16', 'other']] as const) {
      const r = trapReview(settingsOf, 2, [trick, played('W', answer, 'user')], b)
      expect(r).toMatchObject({ trickTurn: 0, answerTurn: 1, verdict })
      expect(r!.good).toEqual([V('P17'), V('P18')])
    }
  })

  it('has no verdict when the answer was not played', () => {
    expect(trapReview(settingsOf, 2, [trick], b)).toMatchObject({ trickTurn: 0, answerTurn: null, verdict: null })
  })

  it('has no trick turn when the trick is among the initial moves', () => {
    const r = trapReview(settingsOf, 3, [played('W', 'P17', 'user')], b)
    expect(r).toMatchObject({ trickTurn: null, answerTurn: 0, verdict: 'correct' })
  })

  it('is absent outside the traps mode', () => {
    expect(trapReview(base, 0, [], b)).toBeNull()
  })
})

describe('trap_json', () => {
  it('round-trips through the repo', () => {
    const repo = new SessionRepo(openDb(':memory:'))
    const trap = { id: 'abcd1234', index: 2, mirror: true, swapColors: true }
    repo.insertSession({
      id: 's1',
      createdAt: '2026-10-12T10:00:00.000Z',
      finishedAt: null,
      settings: { mode: 'traps', environment: 'empty', userColor: 'W', botRank: '7k', corner: 'TR', trap },
      status: 'playing',
      parentSessionId: null,
      initialMoves: [],
      moves: [],
      summary: null,
    })
    expect(repo.getSession('s1')!.settings).toEqual({ mode: 'traps', environment: 'empty', userColor: 'W', botRank: '7k', corner: 'TR', trap })
  })
})
