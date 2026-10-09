import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import type { ClientMessage, ServerMessage } from '@joseki-dojo/shared'
import { fakeEngine, serviceOptions, testConfig } from '../../test/helpers'
import { buildApp, createServices, type AppServices } from '../app'
import { HealthMonitor } from '../engine/health'

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
    expect(typeof body.reason).toBe('string')
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
