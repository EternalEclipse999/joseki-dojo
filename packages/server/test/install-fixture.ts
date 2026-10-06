import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { strToU8, zipSync } from 'fflate'
import type { AppConfig } from '../src/config'
import type { EngineCommand } from '../src/engine/engine'
import type { KataGoLock, LockedBuild, LockedFile } from '../src/engine/lock'
import { FAKE_KATAGO } from './helpers'

export interface InstallFixture {
  /** A lock whose builds and networks are served by this fixture over plain HTTP. */
  lock: KataGoLock
  /** Request paths in arrival order, e.g. `/human.bin.gz`. */
  requests: string[]
  /** Paths answered with HTTP 500 while listed here. */
  failing: Set<string>
  /** Paths answered with half a body and then silence, until the connection is closed. */
  hanging: Set<string>
  close(): Promise<void>
}

const VERSION = '1.18.1'
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

/**
 * Spec 9: a local download server for installer tests and the install e2e. It serves tiny KataGo "archives" (a zip
 * with a fake executable) for the current OS and two small "networks"; the lock points at them with real checksums.
 */
export async function createInstallFixture(): Promise<InstallFixture> {
  const platform: LockedBuild['platform'] = process.platform === 'win32' ? 'win32' : 'linux'
  const os = platform === 'win32' ? 'windows' : 'linux'
  const exe = platform === 'win32' ? 'katago.exe' : 'katago'
  const archive = (id: string): Uint8Array =>
    zipSync({ [`katago-v${VERSION}-${id}`]: { [exe]: strToU8(`fake katago ${id}`), 'README.txt': strToU8('test build') } })
  const buildPath = (id: string): string => `/katago-v${VERSION}-${id}-${os}-x64.zip`
  const files = new Map<string, Uint8Array>([
    [buildPath('eigenavx2'), archive('eigenavx2')],
    [buildPath('opencl'), archive('opencl')],
    [buildPath('cuda'), archive('cuda')],
    ['/main.bin.gz', strToU8('fake main network')],
    ['/human.bin.gz', strToU8('fake human network')],
  ])
  const requests: string[] = []
  const failing = new Set<string>()
  const hanging = new Set<string>()
  const server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push(path)
    const body = files.get(path)
    if (!body || failing.has(path)) {
      res.statusCode = body ? 500 : 404
      res.end()
      return
    }
    res.setHeader('content-length', body.length)
    if (hanging.has(path)) {
      res.write(body.subarray(0, 4))
      return
    }
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const build = (id: string, kind: LockedBuild['kind'], label: string): LockedBuild => {
    const path = buildPath(id)
    return { id, platform, kind, label, url: base + path, sha256: sha256(files.get(path)!) }
  }
  const model = (path: string): LockedFile => {
    const body = files.get(path)!
    return { file: path.slice(1), url: base + path, sha256: sha256(body), size: body.length }
  }
  return {
    lock: {
      katago: { version: VERSION, builds: [build('eigenavx2', 'cpu', 'CPU'), build('opencl', 'gpu', 'OpenCL'), build('cuda', 'gpu', 'CUDA')] },
      models: { main: model('/main.bin.gz'), human: model('/human.bin.gz') },
    },
    requests,
    failing,
    hanging,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/**
 * The fake KataGo for an installed fixture build: the OpenCL build is recognised by its folder name, and `env`
 * sets each build's behaviour (e.g. `{ gpu: { FAKE_KATAGO_ALWAYS_CRASH: '1' } }`).
 */
export function fakeBuildCommand(env: { cpu?: Record<string, string>; gpu?: Record<string, string> } = {}): (config: AppConfig) => EngineCommand {
  return (config) => ({
    command: process.execPath,
    args: [FAKE_KATAGO],
    env: /opencl/.test(config.katago.path) ? (env.gpu ?? {}) : (env.cpu ?? {}),
  })
}
