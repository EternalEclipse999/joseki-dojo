import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config'
import { fakeEngine, tempDir, testConfig } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { checkEngine, compareVersions, HealthMonitor, missingFiles } from './health'

const engines: KataGoEngine[] = []
const engine = (env: Record<string, string> = {}): KataGoEngine => {
  const e = fakeEngine(env)
  engines.push(e)
  return e
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('compareVersions', () => {
  it('compares numerically', () => {
    expect(compareVersions('1.15.0', '1.15.0')).toBe(0)
    expect(compareVersions('1.9.0', '1.15.0')).toBe(-1)
    expect(compareVersions('1.18.1', '1.15')).toBe(1)
  })
})

describe('missingFiles', () => {
  it('reports the first missing file', () => {
    const dir = tempDir()
    const katago = { path: join(dir, 'katago'), analysisConfig: join(dir, 'a.cfg'), mainModel: join(dir, 'm.bin.gz'), humanModel: join(dir, 'h.bin.gz') }
    writeFileSync(katago.path, '')
    expect(missingFiles({ ...DEFAULT_CONFIG, katago })).toBe(`Нет конфига анализа KataGo: ${katago.analysisConfig}`)
  })

  it('skips file checks for a command override', () => {
    expect(missingFiles(testConfig())).toBeNull()
  })

  it('does not skip the file checks for an empty command override', () => {
    const katago = { ...DEFAULT_CONFIG.katago, path: join(tempDir(), 'nope.exe'), commandOverride: [] }
    expect(missingFiles({ ...DEFAULT_CONFIG, katago })).toBe(`KataGo не найден: ${katago.path}`)
  })
})

describe('checkEngine', () => {
  it('is ready with a working engine', async () => {
    expect(await checkEngine(testConfig(), engine())).toEqual({ state: 'ready', reason: null })
  })

  it('fails for an old KataGo', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_VERSION: '1.14.1' }))
    expect(h).toEqual({ state: 'failed', reason: 'Версия KataGo 1.14.1 старше 1.15.0' })
  })

  it('fails without the human model', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_NO_HUMAN: '1' }))
    expect(h.state).toBe('failed')
    expect(h.reason).toContain('human')
  })

  it('fails when KataGo keeps crashing', async () => {
    const h = await checkEngine(testConfig(), engine({ FAKE_KATAGO_ALWAYS_CRASH: '1' }))
    expect(h.state).toBe('failed')
    expect(h.reason).toContain('аварийно')
  })
})

describe('HealthMonitor', () => {
  it('starts in "starting" and becomes ready after the check', async () => {
    const monitor = new HealthMonitor(testConfig(), engine())
    expect(monitor.get().state).toBe('starting')
    await monitor.check()
    expect(monitor.get()).toEqual({ state: 'ready', reason: null })
  })
})
