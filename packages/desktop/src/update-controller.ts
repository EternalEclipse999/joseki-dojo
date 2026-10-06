import type { AppUpdateState } from '@joseki-dojo/shared'

/** What the controller asks electron-updater (or a test) to do. */
export interface UpdateActions {
  check(): Promise<unknown>
  download(): Promise<unknown>
  /** Stops the server and KataGo, then quits and runs the downloaded installer. */
  install(): Promise<void>
}

type Phase = 'check' | 'download' | 'install'

const FAILED: Record<Phase, string> = {
  check: 'Не удалось проверить обновления',
  download: 'Не удалось скачать обновление',
  install: 'Не удалось установить обновление',
}

/** First line of an updater error, short enough for the update bar. */
function shortMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  const line = text.split('\n')[0].trim()
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

/**
 * Spec 6: the update bar's state machine. Nothing downloads on its own: a found version waits for «Обновить»,
 * the download reports its percentage, and the downloaded update is installed at once. Errors offer «Повторить».
 * electron-updater events are fed in through the `on…` methods.
 */
export class UpdateController {
  private state: AppUpdateState = { status: 'idle' }
  /** The newest version the updater found. */
  private version: string | null = null
  /** What is running now (or ran last): decides which kind of error an updater `error` event is. */
  private phase: Phase = 'check'
  /** What produced the error on screen; a quiet check clears only a check error. */
  private errorPhase: Phase | null = null

  constructor(
    private readonly actions: UpdateActions,
    private readonly publish: (state: AppUpdateState) => void,
  ) {}

  get current(): AppUpdateState {
    return this.state
  }

  /** At start and every 6 hours; skipped while an update is being downloaded or installed. */
  async check(): Promise<void> {
    if (this.busy()) return
    this.phase = 'check'
    try {
      await this.actions.check()
    } catch (err) {
      this.fail(err)
    }
  }

  /** «Обновить». */
  async download(): Promise<void> {
    if (!this.version || this.busy()) return
    this.phase = 'download'
    this.set({ status: 'downloading', version: this.version, percent: 0 })
    try {
      await this.actions.download()
    } catch (err) {
      this.fail(err)
    }
  }

  /** «Повторить»: downloads again when a version is known, otherwise checks again. */
  retry(): Promise<void> {
    return this.version ? this.download() : this.check()
  }

  onAvailable(version: string): void {
    this.version = version
    if (!this.busy()) this.set({ status: 'available', version })
  }

  onNotAvailable(): void {
    if (this.state.status === 'error' && this.errorPhase === 'check') this.set({ status: 'idle' })
  }

  onProgress(percent: number): void {
    if (this.state.status === 'downloading') this.set({ ...this.state, percent: Math.floor(percent) })
  }

  async onDownloaded(version: string): Promise<void> {
    if (this.state.status === 'installing') return // the event can repeat: install once
    this.phase = 'install'
    this.set({ status: 'installing', version })
    try {
      await this.actions.install()
    } catch (err) {
      this.fail(err, true)
    }
  }

  /** electron-updater's `error` event (it also rejects the promise of the running action). */
  onError(err: unknown): void {
    this.fail(err)
  }

  private busy(): boolean {
    return this.state.status === 'downloading' || this.state.status === 'installing'
  }

  private fail(err: unknown, fromAction = false): void {
    // The updater may report late; the install action reports its own failure.
    if (this.state.status === 'installing' && !fromAction) return
    // A failed background check must not hide a version that is already on offer.
    if (this.phase === 'check' && this.version) return
    const message = `${FAILED[this.phase]}: ${shortMessage(err)}`
    if (this.state.status === 'error' && this.state.message === message) return
    this.errorPhase = this.phase
    this.set({ status: 'error', message })
  }

  private set(state: AppUpdateState): void {
    this.state = state
    this.publish(state)
  }
}
