import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AnalysisSettings, SettingsResponse, SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import type { AppConfig, KataGoSettings } from '../config'
import { engineCommand } from '../engine/command'
import type { EngineCommand, KataGoEngine } from '../engine/engine'
import { checkEngine, missingFiles, type HealthMonitor } from '../engine/health'
import { versionWarning, type KataGoLock } from '../engine/lock'

export interface SettingsServiceDeps {
  config: AppConfig
  configFile: string
  modelsDir: string
  engine: KataGoEngine
  health: HealthMonitor
  lock: KataGoLock
  /** Tests substitute the fake KataGo; production builds the real command line. */
  commandFor?: (config: AppConfig) => EngineCommand
}

const MODEL_FILE = /\.(bin|txt)\.gz$|\.bin$/

function validateUpdate(u: SettingsUpdate): string | null {
  const paths = u?.katago ? [u.katago.path, u.katago.analysisConfig, u.katago.mainModel, u.katago.humanModel] : []
  if (paths.length !== 4 || paths.some((p) => typeof p !== 'string' || p.trim() === '')) return 'Укажите все пути'
  const visits = [u.analysis?.reviewVisits, u.analysis?.endVisits]
  if (visits.some((v) => !Number.isInteger(v) || (v as number) < 1 || (v as number) > 100_000)) {
    return 'Число визитов должно быть целым от 1 до 100000'
  }
  return null
}

/** Spec 7a: shows and changes the engine paths; a change is kept only if the restarted KataGo passes its checks. */
export class SettingsService {
  private applying = false
  private readonly commandFor: (config: AppConfig) => EngineCommand

  constructor(private readonly d: SettingsServiceDeps) {
    this.commandFor = d.commandFor ?? engineCommand
  }

  async view(): Promise<SettingsView> {
    const running = this.d.health.get().state === 'ready' ? await this.d.engine.version().catch(() => null) : null
    const { path, analysisConfig, mainModel, humanModel } = this.d.config.katago
    return {
      katago: { path, analysisConfig, mainModel, humanModel },
      analysis: { ...this.d.config.analysis },
      models: this.listModels(),
      lockedVersion: this.d.lock.katago.version,
      runningVersion: running,
      versionWarning: versionWarning(this.d.lock, running),
      defaultBotRank: this.d.config.bot.defaultRank,
    }
  }

  async apply(update: SettingsUpdate): Promise<SettingsResponse> {
    if (this.applying) return { ok: false, reason: 'Настройки уже применяются' }
    const invalid = validateUpdate(update)
    if (invalid) return { ok: false, reason: invalid }
    this.applying = true
    try {
      // Relative paths mean "relative to the config file", like in loadConfig, not to the process's working directory.
      const base = dirname(resolve(this.d.configFile))
      const katago: KataGoSettings = {
        path: resolve(base, update.katago.path),
        analysisConfig: resolve(base, update.katago.analysisConfig),
        mainModel: resolve(base, update.katago.mainModel),
        humanModel: resolve(base, update.katago.humanModel),
      }
      const analysis: AnalysisSettings = { reviewVisits: update.analysis.reviewVisits, endVisits: update.analysis.endVisits }
      const candidate: AppConfig = { ...this.d.config, katago, analysis }
      const missing = missingFiles(candidate)
      if (missing) return { ok: false, reason: missing }

      const previous = this.commandFor(this.d.config)
      let failure: string | null = null
      try {
        await this.d.engine.restartWith(this.commandFor(candidate))
        const health = await checkEngine(candidate, this.d.engine)
        if (health.state !== 'ready') failure = health.reason ?? 'KataGo не запустился'
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e)
      }
      if (failure !== null) {
        await this.d.engine.restartWith(previous).catch(() => undefined)
        await this.d.health.check().catch(() => undefined)
        return { ok: false, reason: failure }
      }

      const prevKatago = this.d.config.katago
      const prevAnalysis: AnalysisSettings = { ...this.d.config.analysis }
      try {
        this.d.config.katago = katago // a test-only commandOverride is dropped here on purpose
        Object.assign(this.d.config.analysis, analysis) // the scheduler holds this same object
        this.persist(katago, analysis)
        await this.d.health.check()
        return { ok: true, settings: await this.view() }
      } catch (e) {
        // A change is kept only if everything succeeds: put the previous engine and config back.
        this.d.config.katago = prevKatago
        Object.assign(this.d.config.analysis, prevAnalysis)
        await this.d.engine.restartWith(previous).catch(() => undefined)
        await this.d.health.check().catch(() => undefined)
        return { ok: false, reason: `Не удалось сохранить настройки: ${e instanceof Error ? e.message : String(e)}` }
      }
    } finally {
      this.applying = false
    }
  }

  private listModels(): string[] {
    if (!existsSync(this.d.modelsDir)) return []
    return readdirSync(this.d.modelsDir)
      .filter((f) => MODEL_FILE.test(f))
      .map((f) => join(this.d.modelsDir, f))
      .sort()
  }

  private persist(katago: KataGoSettings, analysis: AnalysisSettings): void {
    const raw = (existsSync(this.d.configFile) ? JSON.parse(readFileSync(this.d.configFile, 'utf8')) : {}) as Record<string, unknown>
    const { commandOverride: _dropped, ...oldKatago } = (raw.katago ?? {}) as Record<string, unknown>
    raw.katago = { ...oldKatago, ...katago }
    raw.analysis = { ...((raw.analysis ?? {}) as Record<string, unknown>), ...analysis }
    writeFileSync(this.d.configFile, `${JSON.stringify(raw, null, 2)}\n`)
  }
}
