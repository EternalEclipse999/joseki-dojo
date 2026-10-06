// Electron main process (spec 4.1): runs the Joseki Dojo server in this process on 127.0.0.1 and a free port and
// shows it in a window. Player data lives in Electron's userData folder (spec 4.2).
import { createWriteStream, mkdirSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { startServer, type RunningServer } from '@joseki-dojo/server'
import { app, BrowserWindow, dialog, shell } from 'electron'

// Smoke checks run with a throwaway profile (this also gives them their own single-instance lock).
if (process.env.JOSEKI_USER_DATA) app.setPath('userData', process.env.JOSEKI_USER_DATA)

/** Installed app: the files electron-builder put next to app.asar. From sources: the repository root. */
const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', '..')
const webDist = app.isPackaged ? join(resourcesDir, 'web') : join(resourcesDir, 'packages', 'web', 'dist')

let server: RunningServer | null = null
let mainWindow: BrowserWindow | null = null
let logFile: WriteStream | null = null
/** Set once the server is stopped for quitting, so that before-quit lets the app go. */
let quitting = false

function log(line: string): void {
  logFile?.write(`${new Date().toISOString()} ${line}\n`)
  if (!app.isPackaged) console.log(line)
}

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const isWebLink = (url: string): boolean => /^https?:\/\//.test(url)

async function boot(): Promise<void> {
  const userData = app.getPath('userData')
  const dataDir = join(userData, 'data')
  mkdirSync(dataDir, { recursive: true })
  logFile = createWriteStream(join(dataDir, 'joseki-dojo.log'), { flags: 'w' })
  log(`Joseki Dojo ${app.getVersion()}, data: ${userData}`)
  server = await startServer({
    configFile: join(userData, 'config.json'),
    dataDir,
    enginesDir: join(userData, 'engines'),
    lockFile: join(resourcesDir, 'katago.lock.json'),
    webDist,
    port: 0,
    log,
  })
  const origin = server.url
  log(`Server: ${origin}`)

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    title: 'Joseki Dojo',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  mainWindow = win
  // The window shows only the local server; other links open in the player's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    if (event.url.startsWith(origin)) return
    event.preventDefault()
    if (isWebLink(event.url)) void shell.openExternal(event.url)
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })
  await win.loadURL(origin)

  if (process.env.JOSEKI_SMOKE_OUT) await writeSmokeReport(process.env.JOSEKI_SMOKE_OUT, origin)
}

/** Packaging check: what the window and the server report, written to `file`; then the app quits. */
async function writeSmokeReport(file: string, origin: string): Promise<void> {
  const page = await (await fetch(origin)).text()
  const health: unknown = await (await fetch(`${origin}/api/health`)).json()
  const install = (await (await fetch(`${origin}/api/install`)).json()) as { installed: boolean }
  const report = { title: mainWindow?.getTitle(), page: page.includes('<div id="app">'), health, installed: install.installed }
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  app.quit()
}

if (!app.requestSingleInstanceLock()) {
  // Spec 4.1: a second launch only brings the open window to the front.
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())
  // Spec 4.1: stop the server and KataGo before the process exits.
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    quitting = true
    void server
      .close()
      .catch((err: unknown) => log(`Server stop failed: ${String(err)}`))
      .finally(() => app.quit())
  })
  app
    .whenReady()
    .then(boot)
    .catch((err: unknown) => {
      log(`Start failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
      dialog.showErrorBox('Joseki Dojo не запустился', err instanceof Error ? err.message : String(err))
      app.exit(1)
    })
}
