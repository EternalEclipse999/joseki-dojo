import { existsSync, readFileSync } from 'node:fs'
import { PLAYER_LEVELS } from '@joseki-dojo/shared'
import type { Thresholds } from '../config'

/** Spec (repetition) 3.2: the category thresholds of one level, in points. */
export interface LevelThresholds {
  inaccuracy: number
  mistake: number
  blunder: number
}

/** Spec (repetition) 3.2–3.3: the calibrated table; `method` records how it was made. */
export interface ThresholdTable {
  method: Record<string, unknown>
  levels: Record<string, LevelThresholds>
}

export class ThresholdsError extends Error {}

const KEYS = ['inaccuracy', 'mistake', 'blunder'] as const

/** Spec (repetition) 3.2: every level, `0 < inaccuracy < mistake < blunder`, no threshold larger than at a weaker level. */
export function parseThresholdTable(json: string): ThresholdTable {
  const raw = JSON.parse(json) as unknown
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ThresholdsError('not a JSON object')
  const levels = (raw as { levels?: unknown }).levels
  if (typeof levels !== 'object' || levels === null) throw new ThresholdsError('no levels')
  const out: Record<string, LevelThresholds> = {}
  let weaker: [string, LevelThresholds] | null = null
  for (const level of PLAYER_LEVELS) {
    const t = (levels as Record<string, unknown>)[level] as Partial<LevelThresholds> | undefined
    if (!t || KEYS.some((k) => typeof t[k] !== 'number' || !Number.isFinite(t[k]))) throw new ThresholdsError(`no thresholds for ${level}`)
    const v: LevelThresholds = { inaccuracy: t.inaccuracy!, mistake: t.mistake!, blunder: t.blunder! }
    if (!(0 < v.inaccuracy && v.inaccuracy < v.mistake && v.mistake < v.blunder)) throw new ThresholdsError(`${level}: need 0 < inaccuracy < mistake < blunder`)
    if (weaker) for (const k of KEYS) if (v[k] > weaker[1][k]) throw new ThresholdsError(`${level}: ${k} is larger than at ${weaker[0]}`)
    out[level] = v
    weaker = [level, v]
  }
  const method = (raw as { method?: unknown }).method
  return { method: typeof method === 'object' && method !== null ? (method as Record<string, unknown>) : {}, levels: out }
}

/** Spec (repetition) 3.2: null (and one log line) when the file is missing or invalid; no line when no file is configured. */
export function loadThresholds(file: string | null | undefined, log: (line: string) => void): ThresholdTable | null {
  if (!file) return null
  try {
    if (!existsSync(file)) throw new ThresholdsError(`no file ${file}`)
    return parseThresholdTable(readFileSync(file, 'utf8'))
  } catch (err) {
    log(`Таблица порогов недоступна, действуют пороги из конфига: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Spec (repetition) 3.2: the level's thresholds; `punished` is the level's inaccuracy. Without a table — the config's. */
export function thresholdsFor(level: string, table: ThresholdTable | null, fallback: Thresholds): Thresholds {
  const t = table?.levels[level]
  return t ? { ...t, punished: t.inaccuracy } : fallback
}
