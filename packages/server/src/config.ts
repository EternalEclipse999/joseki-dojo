import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { isBotRank } from '@joseki-dojo/shared'

export interface KataGoSettings {
  path: string
  analysisConfig: string
  mainModel: string
  humanModel: string
  /** Tests and e2e only: run this command instead of `katago analysis ...`. */
  commandOverride?: string[]
}

export interface Thresholds {
  inaccuracy: number
  mistake: number
  blunder: number
  punished: number
}

export interface AppConfig {
  port: number
  dataDir: string
  katago: KataGoSettings
  analysis: { reviewVisits: number; endVisits: number }
  thresholds: Thresholds
  bot: { defaultRank: string; temperature: number }
  maxSessionMoves: number
}

export const MAIN_MODEL_FILE = 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz'
export const HUMAN_MODEL_FILE = 'b18c384nbt-humanv0.bin.gz'

export const DEFAULT_CONFIG: AppConfig = {
  port: 5179,
  dataDir: 'data',
  katago: {
    path: process.platform === 'win32' ? 'engines/katago/katago.exe' : 'engines/katago/katago',
    analysisConfig: 'engines/analysis.cfg',
    mainModel: `engines/models/${MAIN_MODEL_FILE}`,
    humanModel: `engines/models/${HUMAN_MODEL_FILE}`,
  },
  analysis: { reviewVisits: 500, endVisits: 200 },
  thresholds: { inaccuracy: 0.5, mistake: 2, blunder: 5, punished: 1 },
  bot: { defaultRank: '7k', temperature: 1 },
  maxSessionMoves: 60,
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Reads `file` (if present) over the defaults. Relative paths resolve against the file's directory. */
export function loadConfig(file: string): AppConfig {
  const baseDir = dirname(resolve(file))
  const raw = (existsSync(file) ? parseJson(file) : {}) as Partial<AppConfig>
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    katago: { ...DEFAULT_CONFIG.katago, ...raw.katago },
    analysis: { ...DEFAULT_CONFIG.analysis, ...raw.analysis },
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...raw.thresholds },
    bot: { ...DEFAULT_CONFIG.bot, ...raw.bot },
  }
  validate(merged)
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p))
  const override = merged.katago.commandOverride?.map((part, i) => {
    if (i === 0) return part === 'node' ? process.execPath : part
    return part.startsWith('./') || part.startsWith('../') ? resolve(baseDir, part) : part
  })
  return {
    ...merged,
    dataDir: abs(merged.dataDir),
    katago: {
      path: abs(merged.katago.path),
      analysisConfig: abs(merged.katago.analysisConfig),
      mainModel: abs(merged.katago.mainModel),
      humanModel: abs(merged.katago.humanModel),
      ...(override ? { commandOverride: override } : {}),
    },
  }
}

function parseJson(file: string): unknown {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value
    throw new Error('ожидался объект JSON')
  } catch (err) {
    throw new ConfigError(`${basename(file)}: некорректный JSON (${err instanceof Error ? err.message : String(err)})`)
  }
}

function validate(c: AppConfig): void {
  const positive = (n: unknown, name: string): void => {
    if (typeof n !== 'number' || !(n > 0)) throw new ConfigError(`${name} must be a positive number`)
  }
  positive(c.port, 'port')
  positive(c.analysis.reviewVisits, 'analysis.reviewVisits')
  positive(c.analysis.endVisits, 'analysis.endVisits')
  positive(c.bot.temperature, 'bot.temperature')
  positive(c.maxSessionMoves, 'maxSessionMoves')
  for (const key of ['inaccuracy', 'mistake', 'blunder', 'punished'] as const) positive(c.thresholds[key], `thresholds.${key}`)
  const t = c.thresholds
  if (!(t.inaccuracy < t.mistake && t.mistake < t.blunder)) {
    throw new ConfigError('thresholds must satisfy inaccuracy < mistake < blunder')
  }
  if (!isBotRank(c.bot.defaultRank)) throw new ConfigError(`bot.defaultRank is not a valid rank: ${c.bot.defaultRank}`)
}
