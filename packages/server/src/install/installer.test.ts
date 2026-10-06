import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInstallFixture, fakeBuildCommand, type InstallFixture } from '../../test/install-fixture'
import { tempDir } from '../../test/helpers'
import { loadConfig } from '../config'
import { KataGoEngine } from '../engine/engine'
import { HealthMonitor } from '../engine/health'
import { lockId } from '../engine/lock'
import { SettingsService } from '../settings/service'
import { engineUpdateAvailable, InstallerService } from './installer'

const EXE = process.platform === 'win32' ? 'katago.exe' : 'katago'
const SLOW = { FAKE_KATAGO_DELAY_MS: '300' }
const CRASH = { FAKE_KATAGO_ALWAYS_CRASH: '1' }

const fixtures: InstallFixture[] = []
const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
  await Promise.all(fixtures.splice(0).map((f) => f.close()))
})

/** A fresh profile without KataGo: the config file does not exist yet, so every path is a missing default. */
async function setup(env: Parameters<typeof fakeBuildCommand>[0] = {}, fixture?: InstallFixture, initial?: object) {
  const fx = fixture ?? (await createInstallFixture())
  if (!fixture) fixtures.push(fx)
  const root = tempDir()
  const configFile = join(root, 'config.json')
  if (initial) writeFileSync(configFile, JSON.stringify(initial))
  const config = loadConfig(configFile)
  const commandFor = fakeBuildCommand(env)
  const engine = new KataGoEngine(commandFor(config))
  engines.push(engine)
  const health = new HealthMonitor(config, engine)
  await health.check()
  const enginesDir = join(root, 'engines')
  const settings = new SettingsService({ config, configFile, modelsDir: join(enginesDir, 'models'), engine, health, lock: fx.lock, commandFor })
  const deps = { config, lock: fx.lock, enginesDir, settings, commandFor, cores: 4, benchmarkVisits: 100 }
  return { fixture: fx, root, configFile, enginesDir, config, health, deps, installer: new InstallerService(deps) }
}

describe('InstallerService', () => {
  it('downloads, checks, benchmarks, keeps the faster build and starts KataGo', async () => {
    const { installer, fixture, configFile, enginesDir, config, health } = await setup({ cpu: SLOW })
    expect(health.get().state).toBe('failed')
    expect(installer.status()).toMatchObject({ step: 'idle', installed: false, updateAvailable: false })

    expect(installer.start().step).toBe('downloading')
    const s = await installer.settled()

    expect(s.error).toBeNull()
    expect(s).toMatchObject({ step: 'done', kind: 'gpu', installed: true, updateAvailable: false })
    expect(s.files.map((f) => f.label)).toEqual(['KataGo для процессора', 'KataGo для видеокарты (OpenCL)', 'Основная сеть', 'Human-сеть'])
    for (const f of s.files) expect(f.done && f.total > 0 && f.received === f.total).toBe(true)
    expect(fixture.requests.some((p) => p.includes('cuda'))).toBe(false)

    const gpuBinary = join(enginesDir, 'katago-1.18.1-opencl', 'katago-v1.18.1-opencl', EXE)
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved.setup).toEqual({ kind: 'gpu', lockId: lockId(fixture.lock) })
    expect(saved.katago).toEqual({
      path: gpuBinary,
      analysisConfig: join(enginesDir, 'analysis-gpu.cfg'),
      mainModel: join(enginesDir, 'models', 'main.bin.gz'),
      humanModel: join(enginesDir, 'models', 'human.bin.gz'),
    })
    expect(saved.analysis.reviewVisits).toBeGreaterThanOrEqual(100)
    expect(config.katago.path).toBe(gpuBinary)
    expect(config.analysis).toEqual(saved.analysis)
    expect(readFileSync(join(enginesDir, 'analysis-gpu.cfg'), 'utf8')).toContain('numSearchThreadsPerAnalysisThread = 8')
    expect(readFileSync(join(enginesDir, 'analysis-cpu.cfg'), 'utf8')).toContain('numSearchThreadsPerAnalysisThread = 2')
    expect(health.get().state).toBe('ready')
  })

  it('keeps the CPU build when it is faster', async () => {
    const { installer } = await setup({ gpu: SLOW })
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', kind: 'cpu' })
  })

  it('falls back to the CPU when the OpenCL build crashes', async () => {
    const { installer, configFile } = await setup({ gpu: CRASH })
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', kind: 'cpu', error: null })
    expect(JSON.parse(readFileSync(configFile, 'utf8')).setup.kind).toBe('cpu')
  })

  it('fails when no build starts and leaves the settings alone', async () => {
    const { installer, configFile, health } = await setup({ cpu: CRASH, gpu: CRASH })
    installer.start()
    const s = await installer.settled()
    expect(s.step).toBe('failed')
    expect(s.error).toMatch(/^KataGo не запустился: KataGo аварийно завершился/)
    expect(s.installed).toBe(false)
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('failed')
  })

  it('reports a failed download, keeps the verified files and fetches only what is missing on retry', async () => {
    const { installer, fixture, enginesDir, configFile } = await setup()
    fixture.failing.add('/human.bin.gz')
    installer.start()
    const failed = await installer.settled()
    expect(failed.step).toBe('failed')
    expect(failed.error).toBe(`Не удалось скачать ${fixture.lock.models.human.url}: HTTP 500`)
    expect(failed.files.map((f) => f.done)).toEqual([true, true, true, false])
    expect(existsSync(join(enginesDir, 'models', 'main.bin.gz'))).toBe(true)
    expect(existsSync(join(enginesDir, 'models', 'human.bin.gz.part'))).toBe(false)
    expect(existsSync(configFile)).toBe(false)

    fixture.failing.clear()
    fixture.requests.length = 0
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', error: null })
    expect(fixture.requests).toEqual(['/human.bin.gz'])
  })

  it('rejects a file whose checksum does not match the lock', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    fixture.lock.models.main.sha256 = '0'.repeat(64)
    const { installer } = await setup({}, fixture)
    installer.start()
    const s = await installer.settled()
    expect(s.step).toBe('failed')
    expect(s.error).toMatch(/^main\.bin\.gz: SHA-256 [0-9a-f]{64} не совпадает с katago\.lock\.json/)
  })

  it('ignores a second start while installing', async () => {
    const { installer, fixture } = await setup()
    installer.start()
    expect(installer.start().step).not.toBe('idle')
    await installer.settled()
    expect(fixture.requests.filter((p) => p === '/main.bin.gz')).toHaveLength(1)
  })

  it('fails at once on a system without KataGo builds', async () => {
    const { deps } = await setup()
    const mac = new InstallerService({ ...deps, platform: 'darwin' })
    expect(mac.start()).toMatchObject({ step: 'failed', error: 'Для этой системы (darwin) нет готовых сборок KataGo' })
  })

  it('stops a running download on close, removes the partial file and never restarts KataGo', async () => {
    const { installer, fixture, enginesDir, deps } = await setup()
    fixture.hanging.add('/main.bin.gz')
    const switchTo = vi.spyOn(deps.settings, 'switchTo')
    installer.start()
    await vi.waitFor(() => expect(existsSync(join(enginesDir, 'models', 'main.bin.gz.part'))).toBe(true), { timeout: 5000, interval: 20 })

    const started = Date.now()
    await installer.close()
    expect(Date.now() - started).toBeLessThan(3000)
    expect(existsSync(join(enginesDir, 'models', 'main.bin.gz.part'))).toBe(false)
    expect(installer.status().step).toBe('failed')
    expect(switchTo).not.toHaveBeenCalled()
  })

  it('stops a benchmark on close: nothing is left running and KataGo is not switched', async () => {
    const { installer, configFile, deps, health } = await setup({ cpu: SLOW, gpu: SLOW })
    const switchTo = vi.spyOn(deps.settings, 'switchTo')
    installer.start()
    await vi.waitFor(() => expect(installer.status().step).toBe('benchmarking-cpu'), { timeout: 10_000, interval: 10 })

    await installer.close()
    expect(installer.status().step).toBe('failed')
    expect((installer as unknown as { bench: unknown }).bench).toBeNull()
    expect(switchTo).not.toHaveBeenCalled()
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('failed')
  })

  it('reports the reason when KataGo rejects the chosen build and leaves the config alone', async () => {
    const { installer, configFile, config, deps, health } = await setup()
    const before = { ...config.katago }
    vi.spyOn(deps.settings, 'switchTo').mockResolvedValue({ ok: false, reason: 'не прошла проверка' })
    installer.start()
    const s = await installer.settled()
    expect(s).toMatchObject({ step: 'failed', error: 'не прошла проверка', kind: null })
    expect(existsSync(configFile)).toBe(false)
    expect(config.katago).toEqual(before)
    expect(health.get().state).toBe('failed')
  })

  it('replaces an existing network whose checksum does not match', async () => {
    const { installer, fixture, enginesDir } = await setup()
    mkdirSync(join(enginesDir, 'models'), { recursive: true })
    writeFileSync(join(enginesDir, 'models', 'main.bin.gz'), 'corrupted')
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', error: null })
    expect(readFileSync(join(enginesDir, 'models', 'main.bin.gz'), 'utf8')).toBe('fake main network')
    expect(fixture.requests).toContain('/main.bin.gz')
  })

  it('clears updateAvailable after installing over an older lock', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    const { installer, configFile } = await setup({}, fixture, { setup: { kind: 'cpu', lockId: '1.17.0/aaaaaaaaaaaa/bbbbbbbbbbbb' } })
    expect(installer.status().updateAvailable).toBe(true)
    installer.start()
    expect(await installer.settled()).toMatchObject({ step: 'done', updateAvailable: false })
    expect(JSON.parse(readFileSync(configFile, 'utf8')).setup.lockId).toBe(lockId(fixture.lock))
  })
})

describe('engineUpdateAvailable', () => {
  it('compares the installer record with the current lock and ignores a manual setup', async () => {
    const fixture = await createInstallFixture()
    fixtures.push(fixture)
    const file = join(tempDir(), 'config.json')
    const withSetup = (setup: object) => {
      writeFileSync(file, JSON.stringify({ setup }))
      return loadConfig(file)
    }
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu', lockId: '1.17.0/aaaaaaaaaaaa/bbbbbbbbbbbb' }), fixture.lock)).toBe(true)
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu', lockId: lockId(fixture.lock) }), fixture.lock)).toBe(false)
    expect(engineUpdateAvailable(withSetup({ kind: 'cpu' }), fixture.lock)).toBe(false)
  })
})
