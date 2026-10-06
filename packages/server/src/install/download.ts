import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import extractZip from 'extract-zip'

/** Windows: antivirus or a just-closed process may hold a file for a moment, so removal and rename are retried. */
const RETRY = { maxRetries: 5, retryDelay: 200 } as const
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (err) {
      if (attempt >= 5 || !LOCK_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(
    createReadStream(file),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        hash.update(chunk)
        done()
      },
    }),
  )
  return hash.digest('hex')
}

export interface DownloadOptions {
  /** Progress lines for a terminal (`npm run setup`); silent by default. */
  log?: (line: string) => void
  /** Bytes received so far and the expected total (0 while the server has not said). */
  onProgress?: (received: number, total: number) => void
  /** Delete an existing file whose checksum differs and download it again; by default such a file is refused. */
  replaceMismatched?: boolean
  /** Abort when no bytes arrive for this long (not a total timeout: big files on slow links are fine). */
  stallTimeoutMs?: number
  /** Aborts the download at once and removes the partial file. */
  signal?: AbortSignal
  /** The HTTP client; the desktop app passes Electron's `net.fetch` (system proxy and certificates). Default: the global `fetch`. */
  fetch?: typeof fetch
}

export const OFFLINE_MESSAGE = 'Нет подключения к интернету или сервер недоступен'
const NETWORK_CODES = /(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_NETWORK_CHANGED|ERR_NETWORK_ACCESS_DENIED|ERR_PROXY_CONNECTION_FAILED|ERR_TIMED_OUT)/

/** The technical cause of a failed fetch (undici hides it in `cause`), for the log. */
function causeText(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause)
  const inner = cause.cause as (Error & { code?: string }) | undefined
  const code = inner?.code ?? (cause as Error & { code?: string }).code
  const text = inner?.message ?? cause.message
  return code && !text.includes(code) ? `${code}: ${text}` : text
}

const isNetworkFailure = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) return false
  return NETWORK_CODES.test(causeText(cause)) || NETWORK_CODES.test(cause.message) || /^fetch failed$/i.test(cause.message)
}

/**
 * Downloads `url` to `dest` and accepts it only if its SHA-256 matches; an existing file is re-checked instead.
 * Any failure removes the partial file.
 */
export async function download(url: string, dest: string, sha256: string, options: DownloadOptions = {}): Promise<void> {
  const { log = () => undefined, onProgress = () => undefined, replaceMismatched = false, stallTimeoutMs = 60_000, signal, fetch: fetchImpl = fetch } = options
  const name = basename(dest)
  const expected = sha256.toLowerCase()
  if (existsSync(dest)) {
    if ((await sha256File(dest)) === expected) {
      log(`Уже скачано и проверено: ${name}`)
      const size = statSync(dest).size
      onProgress(size, size)
      return
    }
    if (!replaceMismatched) {
      throw new Error(`${name}: контрольная сумма не совпадает с katago.lock.json (файл повреждён или другой версии). Удалите его и запустите setup снова.`)
    }
    log(`Файл повреждён или другой версии, скачиваю заново: ${name}`)
    rmSync(dest, { force: true, ...RETRY })
  }
  mkdirSync(dirname(dest), { recursive: true })
  log(`Скачиваю ${url}`)
  const partial = `${dest}.part`
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  let stalled = false
  let timer: NodeJS.Timeout | undefined
  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      controller.abort()
    }, stallTimeoutMs)
  }
  const fail = (cause: unknown): Error => {
    if (signal?.aborted) return new Error(`Загрузка ${url} остановлена`)
    if (stalled) return new Error(`Не удалось скачать ${url}: загрузка зависла, нет данных ${Math.round(stallTimeoutMs / 1000)} с`)
    if (cause instanceof Error && cause.message.startsWith('Не удалось скачать')) return cause
    const detail = causeText(cause)
    if (isNetworkFailure(cause)) {
      log(`Не удалось скачать ${url}: ${detail}`)
      return new Error(OFFLINE_MESSAGE)
    }
    return new Error(`Не удалось скачать ${url}: ${detail}`)
  }
  try {
    if (signal?.aborted) throw fail(undefined)
    arm()
    let res: Response
    try {
      res = await fetchImpl(url, { signal: controller.signal })
    } catch (err) {
      throw fail(err)
    }
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = createHash('sha256')
    let received = 0
    let shown = -1
    onProgress(0, total)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        arm()
        hash.update(chunk)
        received += chunk.length
        onProgress(received, total)
        const pct = total > 0 ? Math.floor((received / total) * 100) : -1
        if (pct >= 0 && pct % 10 === 0 && pct !== shown) {
          shown = pct
          log(`  ${name}: ${pct}%`)
        }
        done(null, chunk)
      },
    })
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), meter, createWriteStream(partial), { signal: controller.signal })
    } catch (err) {
      throw fail(err)
    }
    const actual = hash.digest('hex')
    if (actual !== expected) throw new Error(`${name}: SHA-256 ${actual} не совпадает с katago.lock.json (${expected})`)
    renameSync(partial, dest)
  } catch (err) {
    rmSync(partial, { force: true })
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Finds the KataGo executable anywhere under `dir`. */
export function findKatagoBinary(dir: string): string | null {
  const name = process.platform === 'win32' ? 'katago.exe' : 'katago'
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findKatagoBinary(full)
      if (found) return found
    }
  }
  return null
}

/**
 * Unpacks a KataGo archive into `dir` and returns the executable. A `dir` that already holds the executable is kept
 * as is (that KataGo may be running). The archive is unpacked into `<dir>.part` first and renamed when complete, so
 * an interrupted extraction never leaves a half-filled `dir`.
 */
export async function extractBuild(zipFile: string, dir: string): Promise<string> {
  const existing = existsSync(dir) ? findKatagoBinary(dir) : null
  if (existing) return existing
  const partial = `${dir}.part`
  rmSync(partial, { recursive: true, force: true, ...RETRY })
  try {
    await extractZip(zipFile, { dir: resolve(partial) })
    const found = findKatagoBinary(partial)
    if (!found) throw new Error(`В архиве нет исполняемого файла KataGo: ${basename(zipFile)}`)
    rmSync(dir, { recursive: true, force: true, ...RETRY })
    await renameRetrying(partial, dir)
    const bin = join(dir, relative(partial, found))
    if (process.platform !== 'win32') chmodSync(bin, 0o755)
    return bin
  } catch (err) {
    rmSync(partial, { recursive: true, force: true, ...RETRY })
    throw err
  }
}
