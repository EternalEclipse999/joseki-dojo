import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_CONFIG, loadConfig } from './config'

function configFile(content?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'joseki-config-'))
  const file = join(dir, 'config.local.json')
  if (content) writeFileSync(file, JSON.stringify(content))
  return file
}

describe('loadConfig', () => {
  it('rejects malformed JSON with a ConfigError naming the file', () => {
    const file = configFile()
    writeFileSync(file, '{ not json')
    expect(() => loadConfig(file)).toThrow(ConfigError)
    expect(() => loadConfig(file)).toThrow(/config\.local\.json: некорректный JSON/)
  })

  it('rejects valid JSON that is not an object', () => {
    for (const text of ['null', '[]', '42']) {
      const file = configFile()
      writeFileSync(file, text)
      expect(() => loadConfig(file)).toThrow(ConfigError)
      expect(() => loadConfig(file)).toThrow(/config\.local\.json/)
    }
  })

  it('uses defaults when the file is missing and resolves paths against its directory', () => {
    const file = configFile()
    const c = loadConfig(file)
    expect(c.port).toBe(5179)
    expect(c.analysis).toEqual({ reviewVisits: 500, endVisits: 200 })
    expect(c.dataDir).toBe(join(file, '..', 'data'))
    expect(c.katago.mainModel).toBe(join(file, '..', DEFAULT_CONFIG.katago.mainModel))
  })

  it('merges nested sections', () => {
    const c = loadConfig(configFile({ analysis: { reviewVisits: 900 }, thresholds: { punished: 0.5 } }))
    expect(c.analysis).toEqual({ reviewVisits: 900, endVisits: 200 })
    expect(c.thresholds).toEqual({ inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 0.5 })
  })

  it('keeps absolute paths', () => {
    const abs = join(tmpdir(), 'katago-bin')
    expect(loadConfig(configFile({ katago: { path: abs } })).katago.path).toBe(abs)
  })

  it('resolves command override arguments', () => {
    const file = configFile({ katago: { commandOverride: ['node', '../fake.mjs', '--flag'] } })
    const c = loadConfig(file)
    expect(c.katago.commandOverride).toEqual([process.execPath, join(file, '..', '..', 'fake.mjs'), '--flag'])
  })

  it('rejects thresholds out of order', () => {
    expect(() => loadConfig(configFile({ thresholds: { mistake: 6 } }))).toThrow(ConfigError)
  })

  it('rejects an unknown rank', () => {
    expect(() => loadConfig(configFile({ bot: { defaultRank: '42k' } }))).toThrow(ConfigError)
  })

  it('rejects non-positive numbers', () => {
    expect(() => loadConfig(configFile({ analysis: { endVisits: 0 } }))).toThrow(ConfigError)
    expect(() => loadConfig(configFile({ maxSessionMoves: -1 }))).toThrow(ConfigError)
  })
})
