import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import type { InstallFile, InstallStatus, InstallStep } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import { KataGoEngine, type EngineCommand } from '../engine/engine'
import { compareVersions, missingFiles, MIN_KATAGO_VERSION } from '../engine/health'
import { buildsFor, lockId, type KataGoLock, type LockedBuild } from '../engine/lock'
import type { SettingsService } from '../settings/service'
import { measureVisitsPerSecond, visitsForBudget } from './calibrate'
import { download, extractBuild } from './download'
import { analysisConfigText, searchThreadsFor } from './katago-config'

type BuildKind = LockedBuild['kind']

export interface InstallerDeps {
  /** The live config: the installer reads the current paths and, through `settings`, replaces them. */
  config: AppConfig
  lock: KataGoLock
  /** Builds, networks and analysis configs go here (`downloads/`, `katago-<version>-<id>/`, `models/`). */
  enginesDir: string
  /** Switches KataGo to the installed build and saves the config (with the same rollback as the settings screen). */
  settings: SettingsService
  /** Builds the KataGo command line; tests substitute the fake KataGo. */
  commandFor: (config: AppConfig) => EngineCommand
  log?: (line: string) => void
  /** Defaults: the current OS, its logical cores, an 800-visit timed search, 60 s without download progress. */
  platform?: NodeJS.Platform
  cores?: number
  benchmarkVisits?: number
  stallTimeoutMs?: number
}

interface PlannedDownload {
  url: string
  sha256: string
  dest: string
  label: string
  size: number
}

interface Plan {
  downloads: PlannedDownload[]
  builds: { kind: BuildKind; zip: string; dir: string }[]
  mainModel: string
  humanModel: string
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Spec 5.1: the installer set KataGo up from another katago.lock.json; a manual setup (no lockId) is never offered one. */
export function engineUpdateAvailable(config: AppConfig, lock: KataGoLock): boolean {
  const id = config.setup?.lockId
  return typeof id === 'string' && id !== lockId(lock)
}

/**
 * Spec 5: downloads the CPU and OpenCL builds and both networks from katago.lock.json, checks every SHA-256,
 * benchmarks each build, keeps the faster one and switches KataGo to it. One installation runs at a time.
 */
export class InstallerService {
  private step: InstallStep = 'idle'
  private files: InstallFile[] = []
  private error: string | null = null
  private kind: BuildKind | null = null
  private running: Promise<void> | null = null
  private bench: KataGoEngine | null = null
  private closed = false
  private readonly abort = new AbortController()
  private readonly log: (line: string) => void

  constructor(private readonly d: InstallerDeps) {
    this.log = d.log ?? (() => undefined)
  }

  status(): InstallStatus {
    return {
      step: this.step,
      files: this.files.map((f) => ({ ...f })),
      error: this.error,
      installed: missingFiles(this.d.config) === null,
      updateAvailable: engineUpdateAvailable(this.d.config, this.d.lock),
      kind: this.kind,
    }
  }

  /** Starts an installation; while one runs, only returns its state (spec 5.3). */
  start(): InstallStatus {
    if (this.running || this.closed) return this.status()
    this.error = null
    this.kind = null
    let plan: Plan
    try {
      plan = this.plan()
    } catch (err) {
      this.fail(err)
      return this.status()
    }
    this.files = plan.downloads.map((d) => ({ name: basename(d.dest), label: d.label, received: 0, total: d.size, done: false }))
    this.step = 'downloading'
    this.running = this.run(plan).finally(() => {
      this.running = null
    })
    return this.status()
  }

  /** Resolves when no installation is running. */
  async settled(): Promise<InstallStatus> {
    await this.running
    return this.status()
  }

  /**
   * Server shutdown: aborts the running installation (download, benchmark) and waits until it has ended, so that no
   * KataGo is started or config written after this resolves.
   */
  async close(): Promise<void> {
    this.closed = true
    this.abort.abort()
    await this.bench?.stop()
    await this.running?.catch(() => undefined)
  }

  private plan(): Plan {
    const platform = this.d.platform ?? process.platform
    const builds = buildsFor(this.d.lock, platform)
    const cpu = builds.find((b) => b.kind === 'cpu')
    const gpu = builds.find((b) => b.id === 'opencl')
    if (!cpu) throw new Error(`Для этой системы (${platform}) нет готовых сборок KataGo`)
    const { version } = this.d.lock.katago
    const dir = this.d.enginesDir
    const chosen: [LockedBuild, string][] = [[cpu, 'KataGo для процессора']]
    if (gpu) chosen.push([gpu, 'KataGo для видеокарты (OpenCL)'])
    const plan: Plan = {
      downloads: [],
      builds: [],
      mainModel: join(dir, 'models', this.d.lock.models.main.file),
      humanModel: join(dir, 'models', this.d.lock.models.human.file),
    }
    for (const [b, label] of chosen) {
      const zip = join(dir, 'downloads', basename(new URL(b.url).pathname))
      plan.downloads.push({ url: b.url, sha256: b.sha256, dest: zip, label, size: 0 })
      plan.builds.push({ kind: b.kind, zip, dir: join(dir, `katago-${version}-${b.id}`) })
    }
    const { main, human } = this.d.lock.models
    plan.downloads.push({ url: main.url, sha256: main.sha256, dest: plan.mainModel, label: 'Основная сеть', size: main.size })
    plan.downloads.push({ url: human.url, sha256: human.sha256, dest: plan.humanModel, label: 'Human-сеть', size: human.size })
    return plan
  }

  private async run(plan: Plan): Promise<void> {
    try {
      for (const [i, d] of plan.downloads.entries()) {
        const file = this.files[i]
        await download(d.url, d.dest, d.sha256, {
          replaceMismatched: true,
          stallTimeoutMs: this.d.stallTimeoutMs,
          signal: this.abort.signal,
          onProgress: (received, total) => {
            file.received = received
            if (total > 0) file.total = total
          },
        })
        file.done = true
        if (file.total === 0) file.total = file.received
        this.alive()
      }

      this.step = 'extracting'
      const binaries = new Map<BuildKind, string>()
      for (const b of plan.builds) {
        this.alive()
        binaries.set(b.kind, await extractBuild(b.zip, b.dir))
      }

      const speeds = new Map<BuildKind, number>()
      const errors: string[] = []
      for (const kind of ['cpu', 'gpu'] as const) {
        const bin = binaries.get(kind)
        if (!bin) continue
        this.alive()
        this.step = kind === 'cpu' ? 'benchmarking-cpu' : 'benchmarking-gpu'
        try {
          const vps = await this.benchmark(kind, bin, plan)
          speeds.set(kind, vps)
          this.log(`[install] ${kind}: ${Math.round(vps)} визитов/с`)
        } catch (err) {
          // Spec 5.2: a GPU that does not start (no card, no driver) only means the CPU build is used.
          errors.push(message(err))
          this.log(`[install] ${kind}: ${message(err)}`)
        }
      }
      const ranked = [...speeds].sort((a, b) => b[1] - a[1])
      if (ranked.length === 0) throw new Error(`KataGo не запустился: ${errors[0] ?? 'нет подходящей сборки'}`)
      const [kind, vps] = ranked[0]

      this.alive()
      this.step = 'finishing'
      const katago = { path: binaries.get(kind)!, analysisConfig: this.analysisConfig(kind), mainModel: plan.mainModel, humanModel: plan.humanModel }
      const r = await this.d.settings.switchTo(katago, visitsForBudget(vps), { kind, lockId: lockId(this.d.lock) })
      if (!r.ok) throw new Error(r.reason)
      this.kind = kind
      this.step = 'done'
    } catch (err) {
      this.fail(err)
    }
  }

  /** Runs `bin` alone and measures its visits per second (the startup timeout allows for OpenCL tuning). */
  private async benchmark(kind: BuildKind, bin: string, plan: Plan): Promise<number> {
    const logDir = join(this.d.config.dataDir, 'katago-logs')
    mkdirSync(logDir, { recursive: true })
    const cores = this.d.cores ?? availableParallelism()
    writeFileSync(this.analysisConfig(kind), analysisConfigText({ logDir, searchThreadsPerAnalysisThread: searchThreadsFor(kind, cores) }))
    const candidate: AppConfig = {
      ...this.d.config,
      katago: { path: bin, analysisConfig: this.analysisConfig(kind), mainModel: plan.mainModel, humanModel: plan.humanModel },
    }
    this.alive()
    const engine = new KataGoEngine(this.d.commandFor(candidate), (line) => this.log(`[katago ${kind}] ${line}`), { maxRestarts: 0 })
    this.bench = engine
    try {
      engine.start()
      const version = await engine.version()
      if (compareVersions(version, MIN_KATAGO_VERSION) < 0) throw new Error(`нужна KataGo ${MIN_KATAGO_VERSION} или новее, а запущена ${version}`)
      return await measureVisitsPerSecond(engine, this.d.benchmarkVisits)
    } finally {
      this.bench = null
      await engine.stop()
    }
  }

  private analysisConfig(kind: BuildKind): string {
    return join(this.d.enginesDir, `analysis-${kind}.cfg`)
  }

  private alive(): void {
    if (this.closed) throw new Error('Сервер остановлен')
  }

  private fail(err: unknown): void {
    this.error = message(err)
    this.step = 'failed'
    this.log(`[install] ${this.error}`)
  }
}
