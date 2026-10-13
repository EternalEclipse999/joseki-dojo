import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gtpToVertex, type HealthResponse, type InstallStatus, type Vertex } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_KATAGO, REPO_LOCK, tempDir } from '../test/helpers'
import { createInstallFixture, fakeBuildCommand, type InstallFixture } from '../test/install-fixture'
import { encodeJdb, type JdbNode, type JdbTree } from './jdb'
import { startServer, type RunningServer } from './start'
import { writeTestTraps } from './traps/fixture'

const servers: RunningServer[] = []
const fixtures: InstallFixture[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})

const getJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>

async function health(server: RunningServer, state: HealthResponse['state']): Promise<HealthResponse> {
  return vi.waitFor(
    async () => {
      const h = await getJson<HealthResponse>(`${server.url}/api/health`)
      if (h.state !== state) throw new Error(`health is ${h.state}`)
      return h
    },
    { timeout: 10_000, interval: 50 },
  )
}

describe('startServer', () => {
  it('runs with explicit paths on a free port and serves the web UI', async () => {
    const root = tempDir()
    const configFile = join(root, 'profile', 'config.json')
    mkdirSync(join(root, 'profile'))
    writeFileSync(configFile, JSON.stringify({ katago: { commandOverride: [process.execPath, FAKE_KATAGO] } }))
    const webDist = join(root, 'web')
    mkdirSync(webDist)
    writeFileSync(join(webDist, 'index.html'), '<div id="app"></div>')

    const server = await startServer({ configFile, dataDir: join(root, 'data'), enginesDir: join(root, 'engines'), lockFile: REPO_LOCK, webDist, port: 0, log: () => undefined })
    servers.push(server)

    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
    expect(await (await fetch(server.url)).text()).toContain('<div id="app"></div>')
    await health(server, 'ready')
    expect(existsSync(join(root, 'data', 'joseki-dojo.sqlite'))).toBe(true)
    expect(await getJson<InstallStatus>(`${server.url}/api/install`)).toEqual({
      step: 'idle',
      files: [],
      error: null,
      installed: true,
      updateAvailable: false,
      kind: null,
      note: null,
    })

    await server.close()
    await server.close() // a second close is harmless
    expect(server.services.engine.pendingCount).toBe(0)
  })

  it('installs KataGo through /api/install when it is missing', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    const root = tempDir()
    const server = await startServer({
      configFile: join(root, 'config.json'),
      dataDir: join(root, 'data'),
      enginesDir: join(root, 'engines'),
      lockFile: REPO_LOCK,
      webDist: null,
      port: 0,
      log: () => undefined,
      lock: fixture.lock,
      commandFor: fakeBuildCommand(),
    })
    servers.push(server)

    expect((await health(server, 'failed')).reason).toMatch(/^KataGo не найден/)
    expect(await getJson<InstallStatus>(`${server.url}/api/install`)).toMatchObject({ step: 'idle', installed: false })

    const started = (await (await fetch(`${server.url}/api/install`, { method: 'POST' })).json()) as InstallStatus
    expect(started.step).toBe('downloading')
    expect(started.files).toHaveLength(4)

    await vi.waitFor(
      async () => {
        const s = await getJson<InstallStatus>(`${server.url}/api/install`)
        if (s.step !== 'done') throw new Error(`install is ${s.step}: ${s.error}`)
      },
      { timeout: 10_000, interval: 50 },
    )
    await health(server, 'ready')
    expect(existsSync(join(root, 'config.json'))).toBe(true)
  })

  describe('traps base', () => {
    async function startWith(trapsFile: string): Promise<{ lines: string[]; traps: unknown }> {
      const root = tempDir()
      const lines: string[] = []
      const server = await startServer({
        configFile: join(root, 'config.json'),
        dataDir: join(root, 'data'),
        enginesDir: join(root, 'engines'),
        lockFile: REPO_LOCK,
        webDist: null,
        port: 0,
        log: (line) => void lines.push(line),
        trapsFile,
      })
      servers.push(server)
      return { lines, traps: await getJson(`${server.url}/api/traps`) }
    }

    it('starts with a corrupt base and serves an empty book', async () => {
      const file = join(tempDir(), 'traps.jdb')
      writeFileSync(file, Buffer.from([1, 2, 3, 250, 17]))
      const { lines, traps } = await startWith(file)
      expect(lines.some((l) => l.includes('База ловушек недоступна'))).toBe(true)
      expect(traps).toEqual({ count: 0, verified: false })
    })

    it('starts when the base file does not exist', async () => {
      const { lines, traps } = await startWith(join(tempDir(), 'missing.jdb'))
      expect(lines.some((l) => l.includes('База ловушек недоступна'))).toBe(true)
      expect(traps).toEqual({ count: 0, verified: false })
    })

    it('logs how many traps were skipped as unplayable', async () => {
      const file = join(tempDir(), 'traps.jdb')
      const node = (gtp: string, category: JdbNode['category'], children: JdbNode[] = []): JdbNode => ({ move: gtpToVertex(gtp) as Vertex, category, loss: null, children })
      const answers = (): JdbNode[] => [node('P17', 'good'), node('N18', 'caught')]
      // The first trap lands on a taken point: it cannot be played.
      const tree: JdbTree = { kind: 'traps', verified: true, roots: [node('Q16', 'none', [node('Q16', 'trap', answers()), node('R17', 'trap', answers())])] }
      writeFileSync(file, encodeJdb(tree))
      const { lines, traps } = await startWith(file)
      expect(lines).toContain('Пропущено ловушек: 1 (недопустимые позиции)')
      expect(traps).toEqual({ count: 1, verified: true })
    })

    it('serves a valid base', async () => {
      const file = join(tempDir(), 'traps.jdb')
      writeTestTraps(file)
      const { lines, traps } = await startWith(file)
      expect(lines.some((l) => l.includes('База ловушек недоступна'))).toBe(false)
      expect(traps).toEqual({ count: 2, verified: true })
    })
  })
})
