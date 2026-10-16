import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAYER_LEVELS } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { DEFAULT_CONFIG } from '../config'
import { loadThresholds, parseThresholdTable, thresholdsFor, type ThresholdTable } from './thresholds'

/** A valid table: from 20k each level lowers the inaccuracy by 0.03, the mistake by 0.1 and the blunder by 0.3. */
const table = (): ThresholdTable => ({
  method: { positions: 400 },
  levels: Object.fromEntries(PLAYER_LEVELS.map((l, i) => [l, { inaccuracy: 1.5 - i * 0.03, mistake: 5 - i * 0.1, blunder: 12 - i * 0.3 }])),
})

describe('the thresholds table', () => {
  it('reads a valid table', () => {
    const t = parseThresholdTable(JSON.stringify(table()))
    expect(t.levels['20k']).toEqual({ inaccuracy: 1.5, mistake: 5, blunder: 12 })
  })

  it('refuses a missing level, a wrong order and a threshold growing with the level', () => {
    const missing = table()
    delete missing.levels.pro
    expect(() => parseThresholdTable(JSON.stringify(missing))).toThrow('no thresholds for pro')
    const order = table()
    order.levels['5k'] = { inaccuracy: 2, mistake: 1, blunder: 3 }
    expect(() => parseThresholdTable(JSON.stringify(order))).toThrow('5k: need 0 < inaccuracy < mistake < blunder')
    const grows = table()
    grows.levels['1d'] = { ...grows.levels['1d'], mistake: grows.levels['1k'].mistake + 0.5, blunder: 20 }
    expect(() => parseThresholdTable(JSON.stringify(grows))).toThrow('1d: mistake is larger than at 1k')
    expect(() => parseThresholdTable('[]')).toThrow()
  })

  it('takes the level from the table and punished = inaccuracy, else the config thresholds', () => {
    const t = table()
    expect(thresholdsFor('20k', t, DEFAULT_CONFIG.thresholds)).toEqual({ inaccuracy: 1.5, mistake: 5, blunder: 12, punished: 1.5 })
    expect(thresholdsFor('20k', null, DEFAULT_CONFIG.thresholds)).toEqual(DEFAULT_CONFIG.thresholds)
  })

  it('loads a file, logs and returns null for a missing or broken one', () => {
    const dir = tempDir()
    const good = join(dir, 'thresholds.json')
    writeFileSync(good, JSON.stringify(table()))
    const lines: string[] = []
    expect(loadThresholds(good, (l) => lines.push(l))?.levels.pro).toBeDefined()
    expect(lines).toEqual([])
    expect(loadThresholds(join(dir, 'none.json'), (l) => lines.push(l))).toBeNull()
    writeFileSync(join(dir, 'bad.json'), '{}')
    expect(loadThresholds(join(dir, 'bad.json'), (l) => lines.push(l))).toBeNull()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^Таблица порогов недоступна, действуют пороги из конфига: /)
    expect(loadThresholds(null, (l) => lines.push(l))).toBeNull()
    expect(lines).toHaveLength(2)
  })
})
