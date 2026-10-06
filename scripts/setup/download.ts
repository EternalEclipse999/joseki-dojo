import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import extractZip from 'extract-zip'

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

/**
 * Downloads `url` to `dest` and accepts it only if its SHA-256 matches; an existing file is re-checked instead.
 * The request is aborted when no bytes arrive for `stallTimeoutMs` (not a total timeout: big files on slow links are fine).
 * Any failure removes the partial file.
 */
export async function download(
  url: string,
  dest: string,
  sha256: string,
  log: (line: string) => void = console.log,
  stallTimeoutMs = 60_000,
): Promise<void> {
  const name = basename(dest)
  const expected = sha256.toLowerCase()
  if (existsSync(dest)) {
    if ((await sha256File(dest)) !== expected) {
      throw new Error(`${name}: контрольная сумма не совпадает с katago.lock.json (файл повреждён или другой версии). Удалите его и запустите setup снова.`)
    }
    log(`Уже скачано и проверено: ${name}`)
    return
  }
  mkdirSync(dirname(dest), { recursive: true })
  log(`Скачиваю ${url}`)
  const partial = `${dest}.part`
  const controller = new AbortController()
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
    if (stalled) return new Error(`Не удалось скачать ${url}: загрузка зависла, нет данных ${Math.round(stallTimeoutMs / 1000)} с`)
    if (cause instanceof Error && cause.message.startsWith('Не удалось скачать')) return cause
    const detail = cause instanceof Error ? ((cause.cause as Error | undefined)?.message ?? cause.message) : String(cause)
    return new Error(`Не удалось скачать ${url}: ${detail}`)
  }
  try {
    arm()
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
    } catch (err) {
      throw fail(err)
    }
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${url}: HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    const hash = createHash('sha256')
    let received = 0
    let shown = -1
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        arm()
        hash.update(chunk)
        received += chunk.length
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
  }
}

export async function unzip(zipFile: string, dir: string): Promise<void> {
  await extractZip(zipFile, { dir: resolve(dir) })
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
