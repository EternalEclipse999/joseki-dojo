import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { State } from 'ts-fsrs'
import type { AboutInfo, ClientMessage, ServerMessage } from '@joseki-dojo/shared'
import { fakeEngine, serviceOptions, testConfig } from '../../test/helpers'
import { buildApp, createServices, type AppServices } from '../app'
import { CardRepo } from '../cards/repo'
import { newState } from '../cards/schedule'
import { HealthMonitor } from '../engine/health'
import { lineKey } from '../graph/fixture'
import { weightedBook } from '../progress/fixture'
import { GraphCardRepo } from '../progress/repo'
import { StartBook } from '../starts/book'
import { TEST_STARTS_LIST, testStartsTree } from '../starts/fixture'
import { TrapBook } from '../traps/book'
import { testTrapsTree } from '../traps/fixture'
import { decodeJdb, encodeJdb } from '../jdb'

class Client {
  readonly messages: ServerMessage[] = []

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => this.messages.push(JSON.parse(String(data)) as ServerMessage))
  }

  static async connect(url: string): Promise<Client> {
    const ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    return new Client(ws)
  }

  send(msg: ClientMessage | object): void {
    this.ws.send(JSON.stringify(msg))
  }

  next(pred: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    return vi.waitFor(
      () => {
        const found = this.messages.find(pred)
        if (!found) throw new Error('message not received yet')
        return found
      },
      { timeout: 5000 },
    )
  }

  close(): void {
    this.ws.close()
  }
}

const START = { type: 'startSession', settings: { mode: 'free', environment: 'empty', userColor: 'B', botRank: '7k', corner: 'TR' } }

let services: AppServices
let app: FastifyInstance
let host: string
const clients: Client[] = []

const connect = async (): Promise<Client> => {
  const c = await Client.connect(`ws://${host}/ws`)
  clients.push(c)
  return c
}

const startSession = async (c: Client): Promise<string> => {
  c.send(START)
  const m = await c.next((x) => x.type === 'sessionState')
  if (m.type !== 'sessionState') throw new Error('unexpected message')
  return m.session.id
}

const finishSession = async (c: Client, id: string): Promise<void> => {
  c.send({ type: 'playMove', sessionId: id, vertex: [15, 3] })
  await c.next((m) => m.type === 'sessionState' && m.session.moves.length === 2)
  c.send({ type: 'finish', sessionId: id })
  await c.next((m) => m.type === 'reviewReady')
}

beforeEach(async () => {
  const config = testConfig()
  services = createServices(config, fakeEngine(), serviceOptions(config))
  await services.health.check()
  app = await buildApp(services)
  await app.listen({ port: 0, host: '127.0.0.1' })
  host = `127.0.0.1:${(app.server.address() as AddressInfo).port}`
})

afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await app.close()
  await services.engine.stop()
  services.db.close()
})

describe('API', () => {
  it('reports health', async () => {
    const res = await fetch(`http://${host}/api/health`)
    expect(await res.json()).toEqual({ state: 'ready', reason: null })
  })

  it('analyses a variation over the socket and stops the stream when the socket closes', async () => {
    const c = await connect()
    const id = await startSession(c)
    c.send({ type: 'analyzeVariation', sessionId: id, fromTurn: 0, moves: [[3, 3]] })
    await c.next((m) => m.type === 'error' && m.code === 'bad_request')
    await finishSession(c, id)
    c.send({ type: 'analyzeVariation', sessionId: id, fromTurn: 0, moves: [[3, 3]] })
    const done = await c.next((m) => m.type === 'variationAnalysis' && m.done)
    expect(done).toMatchObject({ sessionId: id, fromTurn: 0, moves: [[3, 3]], visits: services.config.analysis.variationVisits })
    expect(c.messages.filter((m) => m.type === 'variationAnalysis').length).toBeGreaterThan(1)
    c.send({ type: 'analyzeVariation', sessionId: 'nope', fromTurn: 0, moves: [] })
    await c.next((m) => m.type === 'error' && m.code === 'session_not_found')

    const stop = vi.spyOn(services.variations, 'stop')
    c.close()
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  })

  it('stops a running variation on stopVariation', async () => {
    const c = await connect()
    const id = await startSession(c)
    await finishSession(c, id)
    const count = (): number => c.messages.filter((m) => m.type === 'variationAnalysis').length
    c.send({ type: 'analyzeVariation', sessionId: id, fromTurn: 0, moves: [[9, 9]] })
    await c.next((m) => m.type === 'variationAnalysis')
    c.send({ type: 'stopVariation', sessionId: id })
    await vi.waitFor(() => expect(services.engine.pendingCount).toBe(0))
    const settled = count()
    // The server's cadence is 0.5 s: a search that kept running would have sent more by now.
    await new Promise((r) => setTimeout(r, 1300))
    expect(count()).toBe(settled)
    expect(c.messages.some((m) => m.type === 'variationAnalysis' && m.done)).toBe(false)
  })

  it('analyses a problem variation over the socket, and answers card_not_found for an unknown card', async () => {
    const now = new Date()
    const data = {
      source: 'mistake', corner: 'TR', userColor: 'B', toMove: 'B', moveNumber: 3, group: '4-4', userMove: [13, 2], userLoss: 2.4,
      moves: [{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 2] }],
      analysis: { scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: [15, 2], loss: 0, pv: [] }] },
    }
    new CardRepo(services.db).insertCard({ id: 'p1', kind: 'move', key: 'move:test', data, state: newState(now), createdAt: now.toISOString() })
    const c = await connect()
    c.send({ type: 'analyzeProblemVariation', cardId: 'p1', answer: [15, 2], fromTurn: 1, moves: [[14, 2]] })
    const done = await c.next((m) => m.type === 'problemVariationAnalysis' && m.done)
    expect(done).toMatchObject({ cardId: 'p1', fromTurn: 1, moves: [[14, 2]], visits: services.config.analysis.variationVisits, position: { turn: 2 } })
    c.send({ type: 'analyzeProblemVariation', cardId: 'nope', answer: [15, 2], fromTurn: 0, moves: [] })
    expect(await c.next((m) => m.type === 'error')).toMatchObject({ code: 'card_not_found', text: { key: 'error.card.notFound' } })

    const stop = vi.spyOn(services.variations, 'stop')
    c.send({ type: 'stopProblemVariation', cardId: 'p1' })
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  })

  it('plays, finishes and serves the review', async () => {
    const c = await connect()
    const id = await startSession(c)
    c.send({ type: 'playMove', sessionId: id, vertex: [15, 3] })
    await c.next((m) => m.type === 'sessionState' && m.session.moves.length === 2)
    c.send({ type: 'finish', sessionId: id })
    await c.next((m) => m.type === 'reviewReady')
    const res = await fetch(`http://${host}/api/sessions/${id}/review`)
    expect(res.status).toBe(200)
    const review = await res.json()
    expect(review.moves).toHaveLength(2)
    expect(review.summary).toEqual({ userLoss: 0, botMistakes: 0, botMistakeLoss: 0, punished: 0, keptPoints: 0 })
  })

  it('reports protocol and game errors', async () => {
    const c = await connect()
    c.send({ type: 'dance' })
    await c.next((m) => m.type === 'error' && m.code === 'bad_request')
    const id = await startSession(c)
    c.send({ type: 'playMove', sessionId: id, vertex: [3, 15] })
    await c.next((m) => m.type === 'error' && m.code === 'outside_zone')
  })

  it('refuses to start while KataGo is not ready', async () => {
    services.health = new HealthMonitor(services.config, services.engine)
    const c = await connect()
    c.send(START)
    const m = await c.next((x) => x.type === 'error')
    expect(m).toMatchObject({ type: 'error', code: 'engine_error' })
  })

  it('re-checks KataGo on demand', async () => {
    services.health = new HealthMonitor(services.config, services.engine)
    expect(services.health.get().state).toBe('starting')
    const res = await fetch(`http://${host}/api/health/recheck`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'ready', reason: null })
    expect(services.health.get().state).toBe('ready')
  })

  it('refuses requests addressed to a foreign host name (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: Number(host.split(':')[1]), path: '/api/health', headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('refuses a WebSocket from a foreign origin but accepts a local one', async () => {
    const ws = new WebSocket(`ws://${host}/ws`, { origin: 'http://evil.example' })
    await expect(
      new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      }),
    ).rejects.toThrow()
    const local = new WebSocket(`ws://${host}/ws`, { origin: `http://${host}` })
    await new Promise<void>((resolve, reject) => {
      local.once('open', () => resolve())
      local.once('error', reject)
    })
    local.close()
  })

  it('serves the novelties: none on a fresh install; seen and dismiss answer the view; an unknown id is 404', async () => {
    expect(await (await fetch(`http://${host}/api/news`)).json()).toEqual({ unseen: [], callout: null })
    const seen = await fetch(`http://${host}/api/news/repetition/seen`, { method: 'POST' })
    expect(seen.status).toBe(200)
    expect(await seen.json()).toEqual({ unseen: [], callout: null })
    const dismissed = await fetch(`http://${host}/api/news/repetition/dismiss`, { method: 'POST' })
    expect(await dismissed.json()).toEqual({ unseen: [], callout: null })
    const unknown = await fetch(`http://${host}/api/news/nope/seen`, { method: 'POST' })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'news_not_found' })
  })

  it('returns 404 for an unknown review', async () => {
    const res = await fetch(`http://${host}/api/sessions/nope/review`)
    expect(res.status).toBe(404)
  })
})

describe('settings API', () => {
  it('shows the settings and refuses paths that do not exist', async () => {
    const view = await (await fetch(`http://${host}/api/settings`)).json()
    expect(view.lockedVersion).toBe('1.18.1')
    expect(view.runningVersion).toBe('1.18.1')
    const res = await fetch(`http://${host}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ katago: { ...view.katago, mainModel: '/nope/main.bin.gz' }, analysis: view.analysis }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.reason).toMatchObject({ key: expect.stringMatching(/^health\.missing\./), params: { path: expect.any(String) } })
  })
})

describe('GET /api/about', () => {
  const about = async (): Promise<AboutInfo> => (await (await fetch(`http://${host}/api/about`)).json()) as AboutInfo

  it('reports the pinned and the running KataGo, the networks by name, and a manual setup without a setup record', async () => {
    expect(await about()).toEqual({
      katago: {
        lockedVersion: '1.18.1',
        runningVersion: '1.18.1',
        setup: 'manual',
        mainModel: 'kata1-b18c384nbt-s9996604416-d4316597426',
        humanModel: 'b18c384nbt-humanv0',
      },
    })
  })

  it('names the build the installer or npm run setup chose', async () => {
    services.config.setup = { kind: 'gpu', lockId: 'lock' }
    expect((await about()).katago.setup).toBe('gpu')
    services.config.setup = { kind: 'cpu' }
    expect((await about()).katago.setup).toBe('cpu')
  })

  it('reports missing KataGo files, no running version while KataGo is not ready, and a .bin network by name', async () => {
    vi.spyOn(services.health, 'get').mockReturnValue({ state: 'starting', reason: null })
    services.config.setup = { kind: 'cpu' }
    // Without the fake KataGo's command line the files are checked, and the configured ones do not exist.
    const { commandOverride: _fake, ...katago } = services.config.katago
    services.config.katago = { ...katago, humanModel: '/nope/custom-net.bin' }
    expect((await about()).katago).toMatchObject({ runningVersion: null, setup: 'missing', humanModel: 'custom-net' })
  })
})

describe('cross-site requests', () => {
  const post = (origin: string | undefined): Promise<number> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = origin ? { origin } : {}
      const req = request({ host: '127.0.0.1', port: Number(host.split(':')[1]), path: '/api/health/recheck', method: 'POST', headers }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })

  it('rejects a POST whose Origin is a foreign site', async () => {
    expect(await post('http://evil.example')).toBe(403)
    expect(await post('http://127.0.0.1.evil.example')).toBe(403)
  })

  it('accepts a POST without Origin or from a local origin of any port', async () => {
    expect(await post(undefined)).toBe(200)
    expect(await post(`http://${host}`)).toBe(200)
    expect(await post('http://localhost:5173')).toBe(200)
  })
})

describe('/api/ui', () => {
  const put = (body: unknown): Promise<Response> =>
    fetch(`http://${host}/api/ui`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('saves a valid theme and serves it back', async () => {
    expect(await (await fetch(`http://${host}/api/ui`)).json()).toEqual({ theme: 'system' })
    const res = await put({ theme: 'dark' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ theme: 'dark' })
    expect(await (await fetch(`http://${host}/api/ui`)).json()).toEqual({ theme: 'dark' })
    expect(JSON.parse(readFileSync(join(services.config.dataDir, 'config.local.json'), 'utf8')).ui).toEqual({ theme: 'dark' })
  })

  it('refuses an unknown theme with 400 and keeps the saved one', async () => {
    await put({ theme: 'light' })
    const res = await put({ theme: 'neon' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { key: 'error.ui.theme' } })
    expect(await (await fetch(`http://${host}/api/ui`)).json()).toEqual({ theme: 'light' })
  })

  it('saves a language next to the theme, and refuses an unknown one without changing anything', async () => {
    await put({ theme: 'dark' })
    const res = await put({ language: 'ja' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ theme: 'dark', language: 'ja' })
    const bad = await put({ theme: 'light', language: 'fr' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: { key: 'error.ui.language' } })
    expect(await (await fetch(`http://${host}/api/ui`)).json()).toEqual({ theme: 'dark', language: 'ja' })
    expect((await put({})).status).toBe(400)
  })
})

describe('/api/player', () => {
  const put = (body: unknown): Promise<Response> =>
    fetch(`http://${host}/api/player`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  it('serves the level, saves a valid one and refuses an unknown one', async () => {
    expect(await (await fetch(`http://${host}/api/player`)).json()).toEqual({ level: '7k' })
    const res = await put({ level: '1d' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ level: '1d' })
    const bad = await put({ level: 'x' })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { key: string } }).error.key).toBe('error.player.level')
    expect(await (await fetch(`http://${host}/api/player`)).json()).toEqual({ level: '1d' })
  })
})

describe('GET /api/progress', () => {
  it('reports no weights without a graph, and refuses a missing or unknown colour', async () => {
    expect(await (await fetch(`http://${host}/api/progress?color=B`)).json()).toEqual({ hasWeights: false, level: '7k', color: 'B', overall: { percent: 0, due: 0 }, positions: {} })
    for (const query of ['', '?color=X', '?color=b']) {
      const bad = await fetch(`http://${host}/api/progress${query}`)
      expect(bad.status).toBe(400)
      expect(await bad.json()).toEqual({ error: 'bad_color' })
    }
  })

  it("serves the progress of the graph's list positions for a colour at the player's level", async () => {
    const config = testConfig()
    // Black's Q16, on the list, is a leaf where White is to move.
    const graph = weightedBook([{ line: [], move: 'Q16', p: 1 }], { 'list-q16': ['Q16'] }, '7k')
    const withGraph = createServices(config, fakeEngine(), serviceOptions(config, { graph }))
    const other = await buildApp(withGraph)
    try {
      const now = new Date()
      const state = { ...newState(now), state: State.Review, reps: 1, stability: 21, due: new Date(now.getTime() + 86_400_000).toISOString() }
      new GraphCardRepo(withGraph.db).upsert({ key: lineKey(['Q16']), kind: 'move', color: 'W', state, createdAt: now.toISOString() })
      const get = async (query: string) => (await other.inject({ method: 'GET', url: `/api/progress${query}`, headers: { host: '127.0.0.1:1' } })).json()
      // White's move card at Q16 is learned; its rest card (all of Q16's weight, as Q16 has no good edges) is not there.
      expect(await get('?color=W')).toEqual({ hasWeights: true, level: '7k', color: 'W', overall: { percent: 0.5, due: 0 }, positions: { 'list-q16': { percent: 0.5, weight: 1, due: false } } })
      expect((await get('?color=B')).positions).toEqual({ 'list-q16': { percent: 0, weight: 1, due: false } })
    } finally {
      await other.close()
      await withGraph.engine.stop()
      withGraph.db.close()
    }
  })
})

describe('GET /api/traps', () => {
  it('reports an empty book without a base', async () => {
    expect(await (await fetch(`http://${host}/api/traps`)).json()).toEqual({ count: 0, verified: false })
  })

  it('reports the loaded base', async () => {
    const config = testConfig()
    const withTraps = createServices(config, fakeEngine(), serviceOptions(config, { traps: TrapBook.fromBase(decodeJdb(encodeJdb(testTrapsTree()))) }))
    const other = await buildApp(withTraps)
    try {
      const res = await other.inject({ method: 'GET', url: '/api/traps', headers: { host: '127.0.0.1:1' } })
      expect(res.json()).toEqual({ count: 2, verified: true })
    } finally {
      await other.close()
      await withTraps.engine.stop()
      withTraps.db.close()
    }
  })
})

describe('GET /api/starts', () => {
  it('reports an empty book without a base', async () => {
    expect(await (await fetch(`http://${host}/api/starts`)).json()).toEqual({ count: 0, list: [], branches: [], groups: [] })
  })

  it('reports the loaded base and its list', async () => {
    const config = testConfig()
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const services = createServices(config, fakeEngine(), serviceOptions(config, { starts }))
    const other = await buildApp(services)
    try {
      const res = await other.inject({ method: 'GET', url: '/api/starts', headers: { host: '127.0.0.1:1' } })
      expect(res.json()).toEqual({ count: 3, list: starts.list(), branches: starts.branches(), groups: starts.groups() })
    } finally {
      await other.close()
      await services.engine.stop()
      services.db.close()
    }
  })
})

describe('/api/cards', () => {
  it('records a card from a list training and serves, re-rates and deletes it', async () => {
    const config = testConfig()
    const starts = StartBook.fromBase(decodeJdb(encodeJdb(testStartsTree()))).withList(JSON.stringify(TEST_STARTS_LIST), () => {})
    const withStarts = createServices(config, fakeEngine(), serviceOptions(config, { starts }))
    await withStarts.health.check()
    const other = await buildApp(withStarts)
    await other.listen({ port: 0, host: '127.0.0.1' })
    const otherHost = `127.0.0.1:${(other.server.address() as AddressInfo).port}`
    const startId = starts.list()[0].id
    const c = await Client.connect(`ws://${otherHost}/ws`)
    clients.push(c)
    try {
      const train = async (previous = ''): Promise<string> => {
        c.send({ type: 'startSession', settings: { mode: 'list', environment: 'empty', userColor: 'W', botRank: '7k', corner: 'TR', startId } })
        const m = await c.next((x) => x.type === 'sessionState' && x.session.id !== previous)
        if (m.type !== 'sessionState') throw new Error('unexpected message')
        c.send({ type: 'playMove', sessionId: m.session.id, vertex: [17, 1] })
        await c.next((x) => x.type === 'sessionState' && x.session.id === m.session.id && x.session.moves.length === 2)
        c.send({ type: 'finish', sessionId: m.session.id })
        await c.next((x) => x.type === 'reviewReady' && x.sessionId === m.session.id)
        return m.session.id
      }
      const first = await train()
      const m = { session: { id: first } }
      const json = async (path: string, init?: RequestInit) => (await fetch(`http://${otherHost}${path}`, init)).json() as Promise<Record<string, any>>
      expect(await json('/api/cards/summary')).toMatchObject({ total: 1 })
      const items = (await json('/api/cards')) as unknown as { id: string; startId: string }[]
      expect(items).toHaveLength(1)
      expect(items[0].startId).toBe(startId)
      const review = await json(`/api/sessions/${m.session.id}/review`)
      expect(review.repetition.auto).toBe('good')
      const put = (body: object) => fetch(`http://${otherHost}/api/cards/reviews/${review.repetition.reviewId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const hard = await put({ rating: 'hard' })
      expect(hard.status).toBe(200)
      expect(await hard.json()).toMatchObject({ rating: 'hard' })
      expect((await put({ rating: 'x' })).status).toBe(400)
      // «Трудно» keeps the card in its learning steps, minutes away: the queue's learn-ahead serves it already.
      expect(await json('/api/cards/due')).toMatchObject({ card: { id: items[0].id, startId } })
      expect((await json('/api/cards/starts'))[startId]).toMatchObject({ dueNow: false })
      const second = await train(first)
      await json(`/api/sessions/${second}/review`)
      expect((await put({ rating: 'good' })).status).toBe(409)
      expect(await (await put({ rating: 'good' })).json()).toEqual({ error: 'not_latest' })
      const unknown = await fetch(`http://${otherHost}/api/cards/reviews/9999`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 'good' }) })
      expect(unknown.status).toBe(404)
      expect(await unknown.json()).toEqual({ error: 'review_not_found' })
      const del = () => fetch(`http://${otherHost}/api/cards/${items[0].id}`, { method: 'DELETE' })
      expect((await del()).status).toBe(204)
      expect((await del()).status).toBe(404)
    } finally {
      await other.close()
      await withStarts.engine.stop()
      withStarts.db.close()
    }
  })
})

describe('POST /api/cards/:id/answer', () => {
  it('judges an answer, and rejects a bad body, an unknown card and a position card', async () => {
    const config = testConfig()
    const withStarts = createServices(config, fakeEngine(), serviceOptions(config))
    await withStarts.health.check()
    const other = await buildApp(withStarts)
    await other.listen({ port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${(other.server.address() as AddressInfo).port}`
    try {
      const repo = new CardRepo(withStarts.db)
      const now = new Date().toISOString()
      const data = {
        source: 'mistake', corner: 'TR', userColor: 'B', toMove: 'B', moveNumber: 3, group: '4-4', userMove: [13, 2], userLoss: 2.4,
        moves: [{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 2] }],
        analysis: { scoreLeadBlack: 0, visits: 10, candidates: [{ vertex: [15, 2], loss: 0, pv: [] }] },
      }
      repo.insertCard({ id: 'p1', kind: 'move', key: 'move:test', data, state: newState(new Date()), createdAt: now })
      repo.insertCard({ id: 'pos1', kind: 'position', key: 'position:x', data: { startId: 'x', userColor: 'B', botRank: '5k' }, state: newState(new Date()), createdAt: now })
      const post = (id: string, body: unknown) => fetch(`${base}/api/cards/${id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const best = await post('p1', { vertex: [15, 2] })
      expect(best.status).toBe(200)
      expect(await best.json()).toMatchObject({ loss: 0, category: 'exact', best: true, repetition: { cardId: 'p1', editable: true } })
      const elsewhere = await post('p1', { vertex: [10, 10] })
      expect(elsewhere.status).toBe(200)
      expect(await elsewhere.json()).toMatchObject({ loss: 0, category: 'exact', best: false })
      expect((await post('p1', { vertex: [1] })).status).toBe(400)
      expect((await post('p1', { vertex: [19, 0] })).status).toBe(400)
      const occupied = await post('p1', { vertex: [15, 3] })
      expect(occupied.status).toBe(400)
      expect(await occupied.json()).toEqual({ error: 'illegal_move' })
      expect((await post('nope', { vertex: [1, 1] })).status).toBe(404)
      expect((await post('pos1', { vertex: [1, 1] })).status).toBe(409)
    } finally {
      await other.close()
      await withStarts.engine.stop()
      withStarts.db.close()
    }
  })
})
