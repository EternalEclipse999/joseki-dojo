import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gtpToVertex, vertexToIndex } from '@joseki-dojo/shared'
import type { ServiceOptions } from '../src/app'
import { DEFAULT_CONFIG, type AppConfig } from '../src/config'
import { engineCommand } from '../src/engine/command'
import { KataGoEngine, type AnalysisStream, type EngineOptions, type StreamingEngine } from '../src/engine/engine'
import { loadLock } from '../src/engine/lock'
import type { AnalysisResponse, KataGoQueryBody } from '../src/engine/katago-types'

export const FAKE_KATAGO = fileURLToPath(new URL('./fake-katago.mjs', import.meta.url))

/** The repository's katago.lock.json (product code always receives the lock path explicitly). */
export const REPO_LOCK = fileURLToPath(new URL('../../../katago.lock.json', import.meta.url))

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'joseki-dojo-'))

export function fakeEngine(env: Record<string, string> = {}, logs: string[] = [], options: EngineOptions = {}): KataGoEngine {
  return new KataGoEngine({ command: process.execPath, args: [FAKE_KATAGO], env }, (line) => logs.push(line), options)
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir: tempDir(),
    katago: { ...DEFAULT_CONFIG.katago, commandOverride: [process.execPath, FAKE_KATAGO] },
    analysis: { reviewVisits: 10, endVisits: 5, variationVisits: 40 },
    ...overrides,
  }
}

/** createServices options for a test config: files under its data folder, the repository lock, the real command line. */
export function serviceOptions(config: AppConfig, overrides: Partial<ServiceOptions> = {}): ServiceOptions {
  return {
    configFile: join(config.dataDir, 'config.local.json'),
    enginesDir: join(config.dataDir, 'engines'),
    lock: loadLock(REPO_LOCK),
    commandFor: engineCommand,
    ...overrides,
  }
}

export const isHumanQuery = (q: KataGoQueryBody): boolean => q.overrideSettings?.humanSLProfile !== undefined
export const isTenukiQuery = (q: KataGoQueryBody): boolean => q.allowMoves !== undefined

/** In-process engine with programmable answers (captures are not simulated). */
export class StubEngine implements StreamingEngine {
  readonly queries: KataGoQueryBody[] = []
  best: (q: KataGoQueryBody) => string = (q) => q.allowMoves?.[0]?.moves[0] ?? 'D4'
  lead: (q: KataGoQueryBody) => number = () => 0
  /** Human policy override for human queries; null = the uniform policy. */
  human: ((q: KataGoQueryBody) => number[]) | null = null
  fail: { when: (q: KataGoQueryBody) => boolean; error: Error } | null = null
  hold = false
  /** Streams fail like this, in order, before any normal one starts. */
  streamFailures: Error[] = []
  failed = false
  /** How many streams were stopped. */
  stops = 0
  private readonly held: (() => void)[] = []

  async analyze(q: KataGoQueryBody): Promise<AnalysisResponse> {
    this.queries.push(q)
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve))
    if (this.fail?.when(q)) {
      const { error } = this.fail
      this.fail = null
      throw error
    }
    return stubResponse(q, this.best(q), this.lead(q), this.human?.(q))
  }

  /** Streams `ceil(limit/4)` and `ceil(limit/2)` visits partials (each in its own timer tick), then the final answer. */
  analyzeStream(q: KataGoQueryBody, onUpdate: (partial: AnalysisResponse) => void): AnalysisStream {
    this.queries.push(q)
    const failure = this.streamFailures.shift()
    if (failure) return { done: Promise.reject(failure), stop: () => {} }
    const limit = q.maxVisits ?? 1
    const answer = (visits: number, during: boolean): AnalysisResponse => ({
      ...stubResponse({ ...q, maxVisits: visits }, this.best(q), this.lead(q)),
      isDuringSearch: during,
    })
    let stopped = false
    let last: AnalysisResponse | null = null
    let settle: (r: AnalysisResponse | null) => void = () => {}
    const done = new Promise<AnalysisResponse | null>((resolve) => {
      settle = resolve
    })
    const steps = [Math.ceil(limit / 4), Math.ceil(limit / 2)]
    const tick = (i: number): void => {
      if (stopped) return
      if (i < steps.length) {
        last = answer(steps[i], true)
        onUpdate(last)
        setTimeout(() => tick(i + 1), 0)
      } else {
        settle(answer(limit, false))
      }
    }
    setTimeout(() => tick(0), 0)
    return {
      done,
      stop: () => {
        if (stopped) return
        stopped = true
        this.stops += 1
        settle(last)
      },
    }
  }

  release(): void {
    this.hold = false
    for (const resolve of this.held.splice(0)) resolve()
  }
}

export function stubResponse(q: KataGoQueryBody, best: string, lead: number, human?: number[]): AnalysisResponse {
  const taken = new Set<number>()
  for (const [, v] of q.moves) {
    const vertex = gtpToVertex(v)
    if (vertex !== 'pass') taken.add(vertexToIndex(vertex))
  }
  const last = q.moves.at(-1)
  const toMove = last ? (last[0] === 'B' ? 'W' : 'B') : 'B'
  const visits = q.maxVisits ?? 1
  const res: AnalysisResponse = {
    id: 'stub',
    turnNumber: q.moves.length,
    isDuringSearch: false,
    rootInfo: { currentPlayer: toMove, scoreLead: lead, winrate: 0.5, visits },
    moveInfos: [{ move: best, order: 0, visits, scoreLead: lead, winrate: 0.5, pv: [best] }],
  }
  if (q.includeOwnership) res.ownership = new Array<number>(361).fill(0)
  if (q.includePolicy) {
    const free = 361 - taken.size
    const policy = Array.from({ length: 362 }, (_, i) => (i === 361 ? 0 : taken.has(i) ? -1 : 1 / free))
    res.policy = policy
    if (isHumanQuery(q)) res.humanPolicy = human ?? [...policy]
  }
  return res
}
