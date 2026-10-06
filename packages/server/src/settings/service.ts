import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AnalysisSettings, SettingsResponse, SettingsUpdate, SettingsView } from '@joseki-dojo/shared'
import type { AppConfig, KataGoSettings, SetupInfo } from '../config'
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
  /** `apply` and `switchTo` run one after another: the later call waits for the earlier one. */
  private tail: Promise<unknown> = Promise.resolve()
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
    const invalid = validateUpdate(update)
    if (invalid) return { ok: false, reason: invalid }
    // Relative paths mean "relative to the config file", like in loadConfig, not to the process's working directory.
    const base = dirname(resolve(this.d.configFile))
    const katago: KataGoSettings = {
      path: resolve(base, update.katago.path),
      analysisConfig: resolve(base, update.katago.analysisConfig),
      mainModel: resolve(base, update.katago.mainModel),
      humanModel: resolve(base, update.katago.humanModel),
    }
    return this.switchTo(katago, { reviewVisits: update.analysis.reviewVisits, endVisits: update.analysis.endVisits })
  }

  /**
   * Restarts KataGo with `katago` and keeps the change only if it passes the startup checks; then updates the live
   * config and saves it, with `setup` when given (the installer's record). On any failure the previous engine stays.
   */
  switchTo(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): Promise<SettingsResponse> {
    const run = this.tail.then(() => this.doSwitch(katago, analysis, setup))
    this.tail = run.catch(() => undefined)
    return run
  }

  private async doSwitch(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): Promise<SettingsResponse> {
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
    const prevSetup = this.d.config.setup
    try {
      this.d.config.katago = katago // a test-only commandOverride is dropped here on purpose
      Object.assign(this.d.config.analysis, analysis) // the scheduler holds this same object
      if (setup) this.d.config.setup = { ...prevSetup, ...setup }
      this.persist(katago, analysis, setup)
      await this.d.health.check()
      return { ok: true, settings: await this.view() }
    } catch (e) {
      // A change is kept only if everything succeeds: put the previous engine and config back.
      this.d.config.katago = prevKatago
      Object.assign(this.d.config.analysis, prevAnalysis)
      this.d.config.setup = prevSetup
      await this.d.engine.restartWith(previous).catch(() => undefined)
      await this.d.health.check().catch(() => undefined)
      return { ok: false, reason: `Не удалось сохранить настройки: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  private listModels(): string[] {
    if (!existsSync(this.d.modelsDir)) return []
    return readdirSync(this.d.modelsDir)
      .filter((f) => MODEL_FILE.test(f))
      .map((f) => join(this.d.modelsDir, f))
      .sort()
  }

  private persist(katago: KataGoSettings, analysis: AnalysisSettings, setup?: SetupInfo): void {
    const raw = (existsSync(this.d.configFile) ? JSON.parse(readFileSync(this.d.configFile, 'utf8')) : {}) as Record<string, unknown>
    const { commandOverride: _dropped, ...oldKatago } = (raw.katago ?? {}) as Record<string, unknown>
    raw.katago = { ...oldKatago, ...katago }
    raw.analysis = { ...((raw.analysis ?? {}) as Record<string, unknown>), ...analysis }
    if (setup) raw.setup = { ...((raw.setup ?? {}) as Record<string, unknown>), ...setup }
    mkdirSync(dirname(this.d.configFile), { recursive: true })
    const tmp = `${this.d.configFile}.tmp`
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
    renameSync(tmp, this.d.configFile)
  }
}
