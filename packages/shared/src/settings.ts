import type { LocalizedText } from './i18n'

export interface EngineSettings {
  path: string
  analysisConfig: string
  mainModel: string
  humanModel: string
}

export interface AnalysisSettings {
  reviewVisits: number
  endVisits: number
  variationVisits: number
}

export interface SettingsView {
  katago: EngineSettings
  analysis: AnalysisSettings
  /** Network files found in engines/models (absolute paths). */
  models: string[]
  lockedVersion: string
  runningVersion: string | null
  versionWarning: LocalizedText | null
  /** `bot.defaultRank` from the config: the rank preselected on the start screen. */
  defaultBotRank: string
}

export interface SettingsUpdate {
  katago: EngineSettings
  analysis: AnalysisSettings
}

export type SettingsResponse = { ok: true; settings: SettingsView } | { ok: false; reason: LocalizedText }
