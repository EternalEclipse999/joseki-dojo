import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AnalysisResponse, KataGoQueryBody, VersionResponse } from './katago-types'

export interface EngineCommand {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type EngineErrorCode = 'engine_failed' | 'query_error'

export class EngineError extends Error {
  constructor(message: string, readonly code: EngineErrorCode) {
    super(message)
    this.name = 'EngineError'
  }
}

/** The part of the engine the rest of the server depends on; tests substitute a stub. */
export interface AnalysisEngine {
  analyze(query: KataGoQueryBody): Promise<AnalysisResponse>
}

export interface EngineOptions {
  /** Consecutive crashes tolerated before the engine is marked failed. */
  maxRestarts?: number
  /** A fresh process that has not replied at all within this time is considered hung (first OpenCL tuning is slow). */
  startupTimeoutMs?: number
  /** Once the process has replied, it is considered hung when queries are pending and it has produced no output for this long. */
  queryTimeoutMs?: number
  watchdogIntervalMs?: number
}

interface Pending {
  line: string
  resolve: (msg: unknown) => void
  reject: (err: Error) => void
}

/**
 * Owns one `katago analysis` process. Queries are JSON lines matched to replies by `id`; each
 * query analyses one turn, so it gets exactly one final reply. After a crash the process restarts
 * and pending queries are resent. More than `maxRestarts` consecutive crashes without a successful
 * reply mark the engine as failed until `reset()`.
 */
export class KataGoEngine implements AnalysisEngine {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<string, Pending>()
  private nextId = 1
  private crashes = 0
  /** Set by `stop()`; queries are refused until `start()`/`reset()` is called explicitly. */
  private stopped = false
  private failedReason: string | null = null
  private spawnedAt = 0
  private replied = false
  /** Last output from the current process, or the moment pending went from empty to non-empty. */
  private lastProgressAt = 0
  private watchdog: NodeJS.Timeout | null = null
  private readonly maxRestarts: number
  private readonly startupTimeoutMs: number
  private readonly queryTimeoutMs: number
  private readonly watchdogIntervalMs: number

  constructor(
    private readonly cmd: EngineCommand,
    private readonly log: (line: string) => void = () => {},
    options: EngineOptions = {},
  ) {
    this.maxRestarts = options.maxRestarts ?? 3
    this.startupTimeoutMs = options.startupTimeoutMs ?? 600_000
    this.queryTimeoutMs = options.queryTimeoutMs ?? 120_000
    this.watchdogIntervalMs = options.watchdogIntervalMs ?? 1_000
  }

  get failure(): string | null {
    return this.failedReason
  }

  get failed(): boolean {
    return this.failedReason !== null
  }

  start(): void {
    if (this.proc || this.failedReason) return
    this.stopped = false
    const proc = spawn(this.cmd.command, this.cmd.args, {
      env: { ...process.env, ...this.cmd.env },
      stdio: 'pipe',
      windowsHide: true,
    })
    this.proc = proc
    this.spawnedAt = Date.now()
    this.replied = false
    this.lastProgressAt = this.spawnedAt
    this.watchdog = setInterval(() => this.checkHang(), this.watchdogIntervalMs)
    this.watchdog.unref()
    let gone = false
    const onGone = (why: string): void => {
      if (gone) return
      gone = true
      this.handleExit(proc, why)
    }
    proc.on('error', (err) => onGone(err.message))
    proc.on('exit', (code, signal) => onGone(`exit code ${code ?? signal}`))
    proc.stdin.on('error', (err) => this.log(`stdin: ${err.message}`))
    createInterface({ input: proc.stdout }).on('line', (line) => this.handleLine(proc, line))
    createInterface({ input: proc.stderr }).on('line', (line) => this.log(line))
    for (const p of this.pending.values()) proc.stdin.write(p.line)
  }

  /** Clears a permanent failure and starts the process again. */
  reset(): void {
    this.failedReason = null
    this.crashes = 0
    this.start()
  }

  async version(): Promise<string> {
    return (await this.send<VersionResponse>({ action: 'query_version' })).version
  }

  analyze(query: KataGoQueryBody): Promise<AnalysisResponse> {
    return this.send<AnalysisResponse>(query)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.stopWatchdog()
    for (const p of this.pending.values()) p.reject(new EngineError('KataGo остановлен', 'engine_failed'))
    this.pending.clear()
    const proc = this.proc
    this.proc = null // so the coming exit is not mistaken for a crash
    if (proc) await this.terminate(proc)
  }

  /** Closes stdin, waits for the process to exit and kills it if it has not done so within 2 s. */
  private async terminate(proc: ChildProcessWithoutNullStreams): Promise<void> {
    if (proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return
    await new Promise<void>((done) => {
      const timer = setTimeout(() => proc.kill(), 2000)
      timer.unref()
      proc.once('exit', () => {
        clearTimeout(timer)
        done()
      })
      proc.stdin.end()
    })
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = null
  }

  private checkHang(): void {
    const proc = this.proc
    if (!proc || this.pending.size === 0) return
    const now = Date.now()
    let limit: number
    if (this.replied) {
      // No-progress check: queued queries may legitimately wait long behind others.
      if (now - this.lastProgressAt <= this.queryTimeoutMs) return
      limit = this.queryTimeoutMs
    } else {
      if (now - this.spawnedAt <= this.startupTimeoutMs) return
      limit = this.startupTimeoutMs
    }
    const err = `KataGo не ответил за ${Math.round(limit / 1000)} с`
    // Startup hang: nothing was answered, fail everything. Later hang: only the oldest query
    // (the one KataGo is stuck on); the rest are resent after the restart.
    const hung = this.replied ? [...this.pending].slice(0, 1) : [...this.pending]
    for (const [id, p] of hung) {
      this.pending.delete(id)
      p.reject(new EngineError(err, 'engine_failed'))
    }
    this.log(`${err}; процесс будет перезапущен`)
    // Until the exit event arrives, another tick would shed the next queued query as well.
    this.stopWatchdog()
    proc.kill() // the exit is handled as a crash: restart and resend what is still pending
  }

  private send<T>(body: object): Promise<T> {
    if (this.failedReason) return Promise.reject(new EngineError(this.failedReason, 'engine_failed'))
    if (this.stopped) return Promise.reject(new EngineError('KataGo остановлен', 'engine_failed'))
    const id = `q${this.nextId++}`
    const line = `${JSON.stringify({ id, ...body })}\n`
    return new Promise<T>((resolve, reject) => {
      if (this.pending.size === 0) this.lastProgressAt = Date.now()
      this.pending.set(id, { line, resolve: resolve as (msg: unknown) => void, reject })
      if (this.proc) this.proc.stdin.write(line)
      else this.start() // start() writes every pending line, including this one
    })
  }

  private handleLine(proc: ChildProcessWithoutNullStreams, line: string): void {
    if (proc === this.proc) {
      this.replied = true
      this.lastProgressAt = Date.now()
    }
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.log(line)
      return
    }
    if (msg.warning !== undefined) {
      this.log(`KataGo warning: ${String(msg.warning)}`)
      return
    }
    const id = typeof msg.id === 'string' ? msg.id : null
    const p = id ? this.pending.get(id) : undefined
    if (msg.error !== undefined) {
      if (id && p) {
        this.pending.delete(id)
        p.reject(new EngineError(`KataGo: ${String(msg.error)}`, 'query_error'))
      } else {
        this.log(`KataGo error: ${String(msg.error)}`)
      }
      return
    }
    if (!id || !p || msg.isDuringSearch === true) return
    this.pending.delete(id)
    this.crashes = 0
    p.resolve(msg)
  }

  private handleExit(proc: ChildProcessWithoutNullStreams, why: string): void {
    if (proc !== this.proc) return // a replaced or intentionally stopped process
    this.proc = null
    this.stopWatchdog()
    this.crashes++
    this.log(`KataGo exited (${why}), crash #${this.crashes}`)
    if (this.crashes > this.maxRestarts) {
      this.failedReason = `KataGo аварийно завершился ${this.crashes} раза подряд (${why})`
      for (const p of this.pending.values()) p.reject(new EngineError(this.failedReason, 'engine_failed'))
      this.pending.clear()
      return
    }
    this.start()
  }
}
