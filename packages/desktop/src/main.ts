// Electron main process (spec 4.1): runs the Joseki Dojo server in this process on 127.0.0.1 and a free port and
// shows it in a window. Player data lives in Electron's userData folder (spec 4.2). Updates come from GitHub
// Releases through electron-updater (spec 6).
import { closeSync, existsSync, mkdirSync, openSync, renameSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { startServer, type RunningServer } from '@joseki-dojo/server'
import type { AppUpdateState } from '@joseki-dojo/shared'
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { CHANNELS } from './channels'
import { runInstall, sameOrigin, withTimeout } from './lifecycle'
import { UpdateController } from './update-controller'

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** If the installer did not start, quitAndInstall leaves the app running with its server stopped: start afresh. */
const RELAUNCH_IF_STILL_RUNNING_MS = 15_000
/** Closing the server and KataGo gets this long; after that the process goes on anyway (a hidden process must not hold the single-instance lock). */
const CLOSE_TIMEOUT_MS = 10_000

// Smoke checks run with a throwaway profile (this also gives them their own single-instance lock).
if (process.env.JOSEKI_USER_DATA) app.setPath('userData', process.env.JOSEKI_USER_DATA)

/** Installed app: the files electron-builder put next to app.asar. From sources: the repository root. */
const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', '..')
const webDist = app.isPackaged ? join(resourcesDir, 'web') : join(resourcesDir, 'packages', 'web', 'dist')

let server: RunningServer | null = null
/** The server start in flight; a quit waits for it and then closes the server. */
let starting: Promise<RunningServer> | null = null
let mainWindow: BrowserWindow | null = null
/** Log file descriptor: lines are written synchronously, so a fatal line is on disk before `app.exit`. */
let logFd: number | null = null
/** The one shutdown sequence: every path that stops the app awaits this same promise. */
let closing: Promise<void> | null = null
/** Closing finished: before-quit lets the app go. */
let closed = false
let quitFlow: Promise<void> | null = null
/** `http://127.0.0.1:<port>` once the server is up. */
let localOrigin: string | null = null
let updateTimer: NodeJS.Timeout | null = null
let watchdog: NodeJS.Timeout | null = null

function log(line: string): void {
  if (logFd !== null) {
    try {
      writeSync(logFd, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // The log is a convenience: a full disk must not take the app down.
    }
  }
  if (!app.isPackaged) console.log(line)
}

/** Stops the timers and the server (waiting for a start still in flight). Safe from any path, any number of times. */
function closeAll(): Promise<void> {
  closing ??= (async () => {
    if (updateTimer) clearInterval(updateTimer)
    updateTimer = null
    try {
      const started = await starting?.catch(() => null)
      await (server ?? started)?.close()
    } catch (err) {
      log(`Server stop failed: ${String(err)}`)
    }
  })()
  return closing
}

/** Quits once everything is closed; if that takes over 10 s the process exits anyway. */
function shutdown(): Promise<void> {
  quitFlow ??= (async () => {
    if (!(await withTimeout(closeAll(), CLOSE_TIMEOUT_MS))) {
      log('Server stop timed out, exiting')
      app.exit(0)
      return
    }
    closed = true
    app.quit()
  })()
  return quitFlow
}

/** Boot failed: log it (synchronously), stop whatever started, exit. */
async function fatal(err: unknown): Promise<void> {
  log(`Start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  dialog.showErrorBox('Joseki Dojo не запустился', err instanceof Error ? err.message : String(err))
  await withTimeout(closeAll(), CLOSE_TIMEOUT_MS)
  if (logFd !== null) closeSync(logFd)
  logFd = null
  app.exit(1)
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const isWebLink = (url: string): boolean => /^https?:\/\//.test(url)

/** Before the first published release GitHub has nothing to offer: that is "no update", not an error. */
const noReleaseYet = (err: unknown): boolean => /No published versions/i.test(String(err))

const restart = (): void => {
  app.relaunch()
  app.exit(0)
}

const updates = new UpdateController(
  {
    check: () =>
      autoUpdater.checkForUpdates().catch((err: unknown) => {
        if (!noReleaseYet(err)) throw err
        return null
      }),
    download: () => autoUpdater.downloadUpdate(),
    // Spec 6: the server and KataGo stop before the installer runs; if anything fails the app restarts with a server.
    install: () =>
      runInstall({
        arm: () => {
          watchdog = setTimeout(restart, CLOSE_TIMEOUT_MS + RELAUNCH_IF_STILL_RUNNING_MS)
        },
        disarm: () => {
          if (watchdog) clearTimeout(watchdog)
          watchdog = null
        },
        close: closeAll,
        quitAndInstall: () => {
          closed = true // everything is stopped: before-quit has nothing left to do
          autoUpdater.quitAndInstall(true, true)
        },
        restart,
        closeTimeoutMs: CLOSE_TIMEOUT_MS,
      }),
  },
  (state: AppUpdateState) => mainWindow?.webContents.send(CHANNELS.state, state),
)

function setUpUpdates(): void {
  // Only the window's own page (the local server) may talk to the updater.
  const fromWindow = (event: IpcMainInvokeEvent): boolean =>
    event.sender === mainWindow?.webContents && localOrigin !== null && sameOrigin(event.senderFrame?.url ?? '', localOrigin)
  ipcMain.handle(CHANNELS.get, (event) => (fromWindow(event) ? updates.current : { status: 'idle' }))
  ipcMain.handle(CHANNELS.download, async (event) => {
    if (fromWindow(event)) await updates.download()
  })
  ipcMain.handle(CHANNELS.retry, async (event) => {
    if (fromWindow(event)) await updates.retry()
  })

  autoUpdater.autoDownload = false // spec 6: nothing downloads until «Обновить»
  autoUpdater.logger = {
    info: (m?: unknown) => log(`[updater] ${String(m)}`),
    warn: (m?: unknown) => log(`[updater] ${String(m)}`),
    error: (m?: unknown) => log(`[updater] ${String(m)}`),
  }
  autoUpdater.on('update-available', (info) => updates.onAvailable(info.version))
  autoUpdater.on('update-not-available', () => updates.onNotAvailable())
  autoUpdater.on('download-progress', (progress) => updates.onProgress(progress.percent))
  autoUpdater.on('update-downloaded', (info) => void updates.onDownloaded(info.version))
  autoUpdater.on('error', (err) => {
    if (!noReleaseYet(err)) updates.onError(err)
  })

  // electron-updater works only in an installed app (it reads resources/app-update.yml).
  if (!app.isPackaged) return
  void updates.check()
  updateTimer = setInterval(() => void updates.check(), UPDATE_CHECK_INTERVAL_MS)
  updateTimer.unref()
}

async function boot(): Promise<void> {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  const logPath = join(dataDir, 'joseki-dojo.log')
  try {
    if (existsSync(logPath)) renameSync(logPath, `${logPath}.old`) // keep the previous run for diagnosing a crash
  } catch {
    // The old log may be locked: appending to it below is fine.
  }
  logFd = openSync(logPath, 'a')
  log(`Joseki Dojo ${app.getVersion()}, data: ${userData}`)
  if (closing) return // a quit arrived before the start
  starting = startServer({
    configFile: join(userData, 'config.json'),
    dataDir,
    enginesDir: join(userData, 'engines'),
    lockFile: join(resourcesDir, 'katago.lock.json'),
    webDist,
    port: 0,
    log,
  })
  server = await starting
  if (closing) return // a quit arrived while the server was starting: closeAll stops it
  const origin = server.url
  localOrigin = origin
  log(`Server: ${origin}`)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    title: 'Joseki Dojo',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  mainWindow = win
  // The window shows only the local server; other links open in the player's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const guard = (openOutside: boolean) => (event: { url: string; preventDefault(): void }) => {
    if (sameOrigin(event.url, origin)) return
    event.preventDefault()
    if (openOutside && isWebLink(event.url)) void shell.openExternal(event.url)
  }
  win.webContents.on('will-navigate', guard(true))
  win.webContents.on('will-redirect', guard(false))
  win.webContents.on('will-frame-navigate', guard(false))
  win.once('ready-to-show', () => win.show())
  win.on('session-end', () => void shutdown()) // Windows logoff or shutdown
  win.on('closed', () => {
    mainWindow = null
  })
  setUpUpdates()
  await win.loadURL(origin)

  if (process.env.JOSEKI_SMOKE_OUT) await writeSmokeReport(process.env.JOSEKI_SMOKE_OUT, origin)
}

/** Packaging check: what the window and the server report, written to `file`; then the app quits. */
async function writeSmokeReport(file: string, origin: string): Promise<void> {
  const page = await (await fetch(origin)).text()
  const health: unknown = await (await fetch(`${origin}/api/health`)).json()
  const install = (await (await fetch(`${origin}/api/install`)).json()) as { installed: boolean }
  const desktopApi = (await mainWindow?.webContents.executeJavaScript('typeof window.dojoDesktop?.getUpdateState')) as string
  const report = { title: mainWindow?.getTitle(), page: page.includes('<div id="app">'), health, installed: install.installed, desktopApi }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  // Spec 4.1: a second launch only brings the open window to the front.
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())
  // Spec 4.1: stop the server and KataGo before the process exits (also while the server is still starting).
  app.on('before-quit', (event) => {
    if (closed) return
    event.preventDefault()
    void shutdown()
  })
  app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => void fatal(err))
}
