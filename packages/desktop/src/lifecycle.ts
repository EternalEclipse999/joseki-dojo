/** Pure pieces of the main process's shutdown and install logic, kept apart from Electron so that they can be tested. */

/** True when `url` is on exactly `origin` (scheme, host and port), not just a string that starts like it. */
export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

/** Resolves true when `work` finished within `ms`, false when the time ran out first (`work` is left running). */
export async function withTimeout(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([work.then(() => true), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface InstallSteps {
  /** Starts the watchdog that restarts the app if the installer never took over. */
  arm(): void
  disarm(): void
  /** The shared close sequence: server, KataGo, timers. */
  close(): Promise<void>
  quitAndInstall(): void
  /** Relaunches the app and exits this process. */
  restart(): void
  closeTimeoutMs: number
}

/**
 * Spec 6: stops the server and runs the installer. Any failure before the app has actually quit restarts the app, so
 * that the player does not end up in a window whose server is gone.
 */
export async function runInstall(s: InstallSteps): Promise<void> {
  s.arm()
  try {
    // A server that will not stop in time must not block the update: the process is about to exit anyway.
    await withTimeout(s.close(), s.closeTimeoutMs)
    s.quitAndInstall()
  } catch (err) {
    s.disarm()
    s.restart()
    throw err
  }
}
