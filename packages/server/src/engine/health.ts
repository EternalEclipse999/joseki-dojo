import { existsSync } from 'node:fs'
import type { HealthResponse } from '@joseki-dojo/shared'
import type { AppConfig } from '../config'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

export const MIN_KATAGO_VERSION = '1.15.0'

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

export function missingFiles(config: AppConfig): string | null {
  if (config.katago.commandOverride && config.katago.commandOverride.length > 0) return null
  const k = config.katago
  const checks: [string, string][] = [
    [k.path, 'KataGo не найден'],
    [k.analysisConfig, 'Нет конфига анализа KataGo'],
    [k.mainModel, 'Нет основной сети KataGo'],
    [k.humanModel, 'Нет human-сети KataGo'],
  ]
  for (const [file, label] of checks) if (!existsSync(file)) return `${label}: ${file}`
  return null
}

/** Startup checks: files, version, and that the human model answers. Never throws. */
export async function checkEngine(config: AppConfig, engine: KataGoEngine): Promise<HealthResponse> {
  const missing = missingFiles(config)
  if (missing) return { state: 'failed', reason: missing }
  try {
    engine.start()
    const version = await engine.version()
    if (compareVersions(version, MIN_KATAGO_VERSION) < 0) {
      return { state: 'failed', reason: `Версия KataGo ${version} старше ${MIN_KATAGO_VERSION}` }
    }
    const probe = await engine.analyze({
      ...baseQuery([]),
      maxVisits: 1,
      includePolicy: true,
      overrideSettings: { humanSLProfile: 'rank_7k' },
    })
    if (!probe.humanPolicy) return { state: 'failed', reason: 'KataGo запущен без human-сети (нет humanPolicy в ответе)' }
    return { state: 'ready', reason: null }
  } catch (err) {
    return { state: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }
}

export class HealthMonitor {
  private current: HealthResponse = { state: 'starting', reason: 'KataGo запускается…' }
  private running: Promise<HealthResponse> | null = null

  constructor(private readonly config: AppConfig, private readonly engine: KataGoEngine) {}

  get(): HealthResponse {
    const failure = this.engine.failure
    if (failure && this.current.state === 'ready') return { state: 'failed', reason: failure }
    return this.current
  }

  check(): Promise<HealthResponse> {
    this.running ??= checkEngine(this.config, this.engine).then((h) => {
      this.current = h
      this.running = null
      return h
    })
    return this.running
  }

  /** Restarts a failed engine and checks again. */
  recover(): Promise<HealthResponse> {
    if (this.engine.failed) this.engine.reset()
    this.current = { state: 'starting', reason: 'KataGo перезапускается…' }
    return this.check()
  }
}
