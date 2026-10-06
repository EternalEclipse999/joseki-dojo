import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SettingsUpdate } from '@joseki-dojo/shared'
import { FAKE_KATAGO, fakeEngine, REPO_LOCK, tempDir, testConfig } from '../../test/helpers'
import type { AppConfig } from '../config'
import type { EngineCommand, KataGoEngine } from '../engine/engine'
import { HealthMonitor } from '../engine/health'
import { loadLock } from '../engine/lock'
import { SettingsService } from './service'

/** A fake installation: real (empty) files on disk; the main network's name selects the fake engine's behaviour. */
function install() {
  const dir = tempDir()
  const models = join(dir, 'models')
  mkdirSync(models)
  const file = (name: string): string => {
    const p = join(dir, name)
    writeFileSync(p, '')
    return p
  }
  const model = (name: string): string => {
    const p = join(models, name)
    writeFileSync(p, '')
    return p
  }
  return {
    dir,
    models,
    katago: file('katago.exe'),
    cfg: file('analysis.cfg'),
    main: model('main.bin.gz'),
    next: model('next.bin.gz'),
    broken: model('broken.bin.gz'),
    human: model('human.bin.gz'),
  }
}

const commandFor = (c: AppConfig): EngineCommand => ({
  command: process.execPath,
  args: [FAKE_KATAGO],
  env: c.katago.mainModel.endsWith('next.bin.gz')
    ? { FAKE_KATAGO_VERSION: '1.18.2' }
    : c.katago.mainModel.endsWith('broken.bin.gz')
      ? { FAKE_KATAGO_NO_HUMAN: '1' }
      : {},
})

const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

async function setup() {
  const inst = install()
  const config = testConfig()
  const engine = fakeEngine()
  engines.push(engine)
  const health = new HealthMonitor(config, engine)
  await health.check()
  const configFile = join(inst.dir, 'config.local.json')
  const settings = new SettingsService({ config, configFile, modelsDir: inst.models, engine, health, lock: loadLock(REPO_LOCK), commandFor })
  const update = (mainModel: string, analysis: Partial<SettingsUpdate['analysis']> = {}): SettingsUpdate => ({
    katago: { path: inst.katago, analysisConfig: inst.cfg, mainModel, humanModel: inst.human },
    analysis: { reviewVisits: 40, endVisits: 20, ...analysis },
  })
  return { inst, config, engine, health, configFile, settings, update }
}

describe('SettingsService', () => {
  it('shows the paths, the networks found and the running version', async () => {
    const { settings, inst } = await setup()
    const v = await settings.view()
    expect(v.lockedVersion).toBe('1.18.1')
    expect(v.runningVersion).toBe('1.18.1')
    expect(v.versionWarning).toBeNull()
    expect(v.models).toEqual([inst.broken, inst.human, inst.main, inst.next].sort())
    expect(v.analysis).toEqual({ reviewVisits: 10, endVisits: 5 })
    expect(v.defaultBotRank).toBe('7k')
  })

  it('rejects invalid input without touching the engine', async () => {
    const { settings, update, inst } = await setup()
    expect(await settings.apply(update(inst.main, { reviewVisits: 0 }))).toEqual({ ok: false, reason: 'Число визитов должно быть целым от 1 до 100000' })
    const missing = join(inst.models, 'missing.bin.gz')
    expect(await settings.apply(update(missing))).toEqual({ ok: false, reason: `Нет основной сети KataGo: ${missing}` })
  })

  it('switches KataGo, saves the config and warns about an unverified version', async () => {
    const { settings, update, inst, config, configFile } = await setup()
    const r = await settings.apply(update(inst.next))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.settings.runningVersion).toBe('1.18.2')
    expect(r.settings.versionWarning).toContain('1.18.2')
    expect(config.katago.mainModel).toBe(inst.next)
    expect(config.katago.commandOverride).toBeUndefined()
    expect(config.analysis).toEqual({ reviewVisits: 40, endVisits: 20 })
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved.katago.mainModel).toBe(inst.next)
    expect(saved.analysis).toEqual({ reviewVisits: 40, endVisits: 20 })
  })

  it('restores the previous engine when the new one fails its checks', async () => {
    const { settings, update, inst, config, configFile, health, engine } = await setup()
    const before = config.katago.mainModel
    const r = await settings.apply(update(inst.broken))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('human')
    expect(config.katago.mainModel).toBe(before)
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('ready')
    expect(await engine.version()).toBe('1.18.1')
  })

  it('rolls everything back when saving the config fails after the engine was switched', async () => {
    const { settings, update, inst, config, configFile, health, engine } = await setup()
    const before = config.katago.mainModel
    const analysisObj = config.analysis
    const analysisBefore = { ...config.analysis }
    writeFileSync(configFile, '{not json')
    const r = await settings.apply(update(inst.next))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('Не удалось сохранить')
    expect(config.katago.mainModel).toBe(before)
    expect(config.analysis).toBe(analysisObj)
    expect(config.analysis).toEqual(analysisBefore)
    expect(health.get().state).toBe('ready')
    expect(await engine.version()).toBe('1.18.1')
    expect((await settings.apply(update(inst.main))).ok).toBe(false) // guard was released: still reaches persist, not 'already applying'
  })

  it('lets a switchTo wait for an apply in progress instead of refusing it', async () => {
    const { settings, update, inst, config } = await setup()
    const order: string[] = []
    const first = settings.apply(update(inst.next)).then((r) => (order.push('apply'), r))
    const second = settings
      .switchTo({ ...config.katago, path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.main, humanModel: inst.human }, { reviewVisits: 33, endVisits: 11 })
      .then((r) => (order.push('switchTo'), r))
    const [a, b] = await Promise.all([first, second])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(order).toEqual(['apply', 'switchTo'])
    expect(config.katago.mainModel).toBe(inst.main)
    expect(config.analysis.reviewVisits).toBe(33)
  })

  it('writes the config atomically: no temp file is left and the file is valid JSON', async () => {
    const { settings, update, inst, configFile } = await setup()
    expect((await settings.apply(update(inst.next))).ok).toBe(true)
    expect(existsSync(`${configFile}.tmp`)).toBe(false)
    expect(JSON.parse(readFileSync(configFile, 'utf8')).katago.mainModel).toBe(inst.next)
  })

  it('resolves relative paths against the config file directory, not the working directory', async () => {
    const { settings, inst, config } = await setup()
    const rel = (p: string): string => relative(inst.dir, p)
    const r = await settings.apply({
      katago: { path: rel(inst.katago), analysisConfig: rel(inst.cfg), mainModel: rel(inst.next), humanModel: rel(inst.human) },
      analysis: { reviewVisits: 40, endVisits: 20 },
    })
    expect(r.ok).toBe(true)
    expect(config.katago.mainModel).toBe(inst.next)
    expect(config.katago.path).toBe(inst.katago)
  })

  it('rolls back when the candidate cannot even be spawned', async () => {
    const { inst, config, configFile, health, engine } = await setup()
    const nul = String.fromCharCode(0)
    const settings = new SettingsService({
      config,
      configFile,
      modelsDir: inst.models,
      engine,
      health,
      lock: loadLock(REPO_LOCK),
      commandFor: (c) => (c.katago.mainModel.endsWith('next.bin.gz') ? { command: `bad${nul}command`, args: [] } : commandFor(c)),
    })
    const before = config.katago.mainModel
    const r = await settings.apply({
      katago: { path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.next, humanModel: inst.human },
      analysis: { reviewVisits: 40, endVisits: 20 },
    })
    expect(r.ok).toBe(false)
    expect(config.katago.mainModel).toBe(before)
    expect(existsSync(configFile)).toBe(false)
    expect(health.get().state).toBe('ready')
    expect(engine.pendingCount).toBe(0)
    expect(await engine.version()).toBe('1.18.1')
  })
})

describe('SettingsService.switchTo', () => {
  it('switches to an installed engine and records who set it up, keeping other config fields', async () => {
    const { settings, inst, config, configFile } = await setup()
    writeFileSync(configFile, JSON.stringify({ bot: { defaultRank: '5k' }, setup: { kind: 'cpu' } }))
    const katago = { path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.main, humanModel: inst.human }
    const r = await settings.switchTo(katago, { reviewVisits: 300, endVisits: 150 }, { kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' })
    expect(r.ok).toBe(true)
    expect(config.setup).toEqual({ kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' })
    expect(config.analysis).toEqual({ reviewVisits: 300, endVisits: 150 })
    const saved = JSON.parse(readFileSync(configFile, 'utf8'))
    expect(saved).toEqual({
      bot: { defaultRank: '5k' },
      setup: { kind: 'gpu', lockId: '1.18.1/aaaaaaaaaaaa/bbbbbbbbbbbb' },
      katago,
      analysis: { reviewVisits: 300, endVisits: 150 },
    })
  })

  it('creates the folder of a config file that does not exist yet', async () => {
    const { inst, config, engine, health } = await setup()
    const configFile = join(inst.dir, 'profile', 'config.json')
    const settings = new SettingsService({ config, configFile, modelsDir: inst.models, engine, health, lock: loadLock(REPO_LOCK), commandFor })
    const katago = { path: inst.katago, analysisConfig: inst.cfg, mainModel: inst.main, humanModel: inst.human }
    expect((await settings.switchTo(katago, { reviewVisits: 300, endVisits: 150 })).ok).toBe(true)
    expect(JSON.parse(readFileSync(configFile, 'utf8')).katago).toEqual(katago)
  })
})
