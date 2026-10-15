import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gtpToVertex, type HealthResponse, type InstallStatus, type Language, type StartsInfo, type UiSettings, type Vertex } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_KATAGO, REPO_LOCK, tempDir } from '../test/helpers'
import { createInstallFixture, fakeBuildCommand, type InstallFixture } from '../test/install-fixture'
import { encodeJdb, type JdbNode, type JdbTree } from './jdb'
import { startServer, type RunningServer } from './start'
import { writeTestStarts } from './starts/fixture'
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

  it('writes initialLanguage into a config without a language, and keeps a saved one', async () => {
    const root = tempDir()
    const configFile = join(root, 'config.json')
    const start = (initialLanguage: Language): Promise<RunningServer> =>
      startServer({ configFile, dataDir: join(root, 'data'), enginesDir: join(root, 'engines'), lockFile: REPO_LOCK, webDist: null, port: 0, log: () => undefined, initialLanguage })
    const first = await start('ko')
    servers.push(first)
    expect(first.services.config.ui.language).toBe('ko')
    await first.close()
    const second = await start('ja')
    servers.push(second)
    expect(second.services.config.ui.language).toBe('ko')
  })

  it('starts when the installer language cannot be saved: the log says so and the language screen stays the fallback', async () => {
    const root = tempDir()
    const blocker = join(root, 'not-a-folder')
    writeFileSync(blocker, '') // the config would live inside a file, so it cannot be written
    const lines: string[] = []
    const server = await startServer({
      configFile: join(blocker, 'config.json'),
      dataDir: join(root, 'data'),
      enginesDir: join(root, 'engines'),
      lockFile: REPO_LOCK,
      webDist: null,
      port: 0,
      log: (line) => void lines.push(line),
      initialLanguage: 'ko',
    })
    servers.push(server)
    expect(lines.filter((l) => l.startsWith('Не удалось сохранить язык из установщика: '))).toHaveLength(1)
    expect(server.services.config.ui.language).toBeUndefined()
    expect((await getJson<UiSettings>(`${server.url}/api/ui`)).language).toBeUndefined()
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

    expect((await health(server, 'failed')).reason).toMatchObject({ key: 'health.missing.katago' })
    expect(await getJson<InstallStatus>(`${server.url}/api/install`)).toMatchObject({ step: 'idle', installed: false })

    const started = (await (await fetch(`${server.url}/api/install`, { method: 'POST' })).json()) as InstallStatus
    expect(started.step).toBe('downloading')
    expect(started.files).toHaveLength(4)

    await vi.waitFor(
      async () => {
        const s = await getJson<InstallStatus>(`${server.url}/api/install`)
        if (s.step !== 'done') throw new Error(`install is ${s.step}: ${JSON.stringify(s.error)}`)
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

  describe('starts base', () => {
    async function startWith(startsFile?: string, startsListFile?: string): Promise<{ lines: string[]; starts: unknown }> {
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
        startsFile,
        startsListFile,
      })
      servers.push(server)
      return { lines, starts: await getJson(`${server.url}/api/starts`) }
    }
    const noStartsLog = (lines: string[]): boolean => lines.some((l) => l.startsWith('База стартовых позиций') || l.startsWith('Список стартовых позиций'))

    it('serves a valid base and its list', async () => {
      const dir = tempDir()
      const base = join(dir, 'starts.jdb')
      const list = join(dir, 'starts-list.json')
      writeTestStarts(base, list)
      const { lines, starts } = await startWith(base, list)
      expect(noStartsLog(lines)).toBe(false)
      expect(starts).toMatchObject({ count: 3 })
      expect((starts as { list: unknown[] }).list).toHaveLength(2)
    })

    it('serves the names in every language from starts-i18n.json next to the list; without it they stay Russian', async () => {
      const dir = tempDir()
      const base = join(dir, 'starts.jdb')
      const list = join(dir, 'starts-list.json')
      writeTestStarts(base, list)
      const missing = await startWith(base, list)
      expect(missing.lines.filter((l) => l.startsWith('Переводы названий стартовых позиций недоступны: '))).toHaveLength(1)
      expect((missing.starts as StartsInfo).list[0].name).toMatchObject({ ru: 'Тестовое начало 4-4', en: 'Тестовое начало 4-4' })
      writeFileSync(join(dir, 'starts-i18n.json'), JSON.stringify({ 'Q16 O17 R14': { en: { name: 'Test start', short: 'Start' } } }))
      const named = await startWith(base, list)
      expect((named.starts as StartsInfo).list[0].name).toMatchObject({ ru: 'Тестовое начало 4-4', en: 'Test start', ja: 'Test start' })
      expect(named.lines.some((l) => l.startsWith('Переводы названий'))).toBe(false)
    })

    it('turns the start modes off for a broken base', async () => {
      const dir = tempDir()
      const base = join(dir, 'starts.jdb')
      writeFileSync(base, 'nonsense')
      const { lines, starts } = await startWith(base, join(dir, 'starts-list.json'))
      expect(lines.some((l) => l.startsWith('База стартовых позиций недоступна: '))).toBe(true)
      expect(starts).toEqual({ count: 0, list: [], branches: [], groups: [] })
    })

    it('turns only the list off for a broken list', async () => {
      const dir = tempDir()
      const base = join(dir, 'starts.jdb')
      const list = join(dir, 'starts-list.json')
      writeTestStarts(base, list)
      writeFileSync(list, 'not json')
      const { lines, starts } = await startWith(base, list)
      expect(lines.some((l) => l.startsWith('Список стартовых позиций недоступен: '))).toBe(true)
      expect(starts).toEqual({ count: 3, list: [], branches: [], groups: [] })
    })

    it('serves an empty book when no files are given', async () => {
      const { lines, starts } = await startWith()
      expect(noStartsLog(lines)).toBe(false)
      expect(starts).toEqual({ count: 0, list: [], branches: [], groups: [] })
    })
  })
})
