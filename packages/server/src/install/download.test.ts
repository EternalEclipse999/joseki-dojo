import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { download, extractBuild, findKatagoBinary, sha256File } from './download'

const temp = (): string => mkdtempSync(join(tmpdir(), 'joseki-setup-'))
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const closers: (() => Promise<void>)[] = []
const EXE = process.platform === 'win32' ? 'katago.exe' : 'katago'

async function serve(body: Buffer): Promise<string> {
  const server = createServer((_req, res) => {
    res.setHeader('content-length', body.length)
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
}

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

describe('download', () => {
  const body = Buffer.from('katago network bytes')

  it('downloads a file, reports progress and verifies its checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    const progress: [number, number][] = []
    await download(await serve(body), dest, sha(body), { onProgress: (received, total) => progress.push([received, total]) })
    expect(readFileSync(dest)).toEqual(body)
    expect(await sha256File(dest)).toBe(sha(body))
    expect(progress[0]).toEqual([0, body.length])
    expect(progress.at(-1)).toEqual([body.length, body.length])
  })

  it('rejects a wrong checksum and leaves nothing behind', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(await serve(body), dest, sha(Buffer.from('other')))).rejects.toThrow(/SHA-256/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('re-checks an existing file instead of downloading it', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, body)
    const logs: string[] = []
    const progress: [number, number][] = []
    await download('https://invalid.example/never-fetched', dest, sha(body), {
      log: (l) => logs.push(l),
      onProgress: (received, total) => progress.push([received, total]),
    })
    expect(logs).toEqual(['Уже скачано и проверено: net.bin.gz'])
    expect(progress).toEqual([[body.length, body.length]])
  })

  it('refuses an existing file with a different checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await expect(download('https://invalid.example/never-fetched', dest, sha(body))).rejects.toThrow(/katago\.lock\.json/)
  })

  it('downloads again over a mismatched file when asked to', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await download(await serve(body), dest, sha(body), { replaceMismatched: true })
    expect(readFileSync(dest)).toEqual(body)
  })
})

describe('download failures', () => {
  const body = Buffer.from('katago network bytes')

  async function serveRaw(handler: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(handler)
    server.on('connection', (s) => s.on('error', () => undefined))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    closers.push(() => {
      server.closeAllConnections()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    })
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
  }

  it('removes the partial file when the connection dies mid-body', async () => {
    const url = await serveRaw((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 })
      res.write(body)
      setTimeout(() => res.destroy(), 50)
    })
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body))).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('says the server is unavailable and logs the URL when the connection is refused', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    const url = `http://127.0.0.1:${port}/file.bin`
    const dest = join(temp(), 'net.bin.gz')
    const logs: string[] = []
    await expect(download(url, dest, sha(body), { log: (l) => logs.push(l) })).rejects.toThrow('Нет подключения к интернету или сервер недоступен')
    expect(logs.join(' | ')).toContain(url)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts a stalled download and leaves no partial file', async () => {
    const url = await serveRaw((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 })
      res.write(body)
    })
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), { stallTimeoutMs: 300 })).rejects.toThrow(/завис/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts when headers never arrive', async () => {
    const url = await serveRaw(() => undefined)
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), { stallTimeoutMs: 300 })).rejects.toThrow(/завис/)
  })

  it('accepts an upper-case checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await download(await serve(body), dest, sha(body).toUpperCase())
    expect(existsSync(dest)).toBe(true)
  })
})

describe('findKatagoBinary', () => {
  it('finds the executable in nested folders', () => {
    const dir = temp()
    const nested = join(dir, 'katago-v1.18.1', 'bin')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, EXE), '')
    expect(findKatagoBinary(dir)).toBe(join(nested, EXE))
    expect(findKatagoBinary(temp())).toBeNull()
  })
})

describe('extractBuild', () => {
  const archive = (files: Record<string, string>): string => {
    const zip = join(temp(), 'build.zip')
    const entries = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)]))
    writeFileSync(zip, zipSync({ 'katago-v1.18.1': entries }))
    return zip
  }

  it('unpacks the archive and returns the executable', async () => {
    const dir = join(temp(), 'katago-1.18.1-eigenavx2')
    const bin = await extractBuild(archive({ [EXE]: 'fake', 'README.txt': 'r' }), dir)
    expect(bin).toBe(join(dir, 'katago-v1.18.1', EXE))
    expect(readFileSync(bin, 'utf8')).toBe('fake')
    expect(existsSync(`${dir}.part`)).toBe(false)
  })

  it('keeps a folder that already has the executable', async () => {
    const zip = archive({ [EXE]: 'fake' })
    const dir = join(temp(), 'katago')
    const bin = await extractBuild(zip, dir)
    rmSync(zip)
    expect(await extractBuild(zip, dir)).toBe(bin)
  })

  it('rejects an archive without KataGo and leaves nothing behind', async () => {
    const dir = join(temp(), 'katago')
    await expect(extractBuild(archive({ 'README.txt': 'r' }), dir)).rejects.toThrow(/нет исполняемого файла KataGo/)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(`${dir}.part`)).toBe(false)
  })
})

describe('download: injected fetch and network errors', () => {
  const body = Buffer.from('katago network bytes')

  it('uses the injected fetch instead of the global one', async () => {
    const calls: string[] = []
    const injected = (async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response(body, { headers: { 'content-length': String(body.length) } })
    }) as typeof fetch
    const dest = join(temp(), 'net.bin.gz')
    await download('https://example.invalid/file.bin', dest, sha(body), { fetch: injected })
    expect(calls).toEqual(['https://example.invalid/file.bin'])
    expect(readFileSync(dest)).toEqual(body)
  })

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'])('says the network is unavailable on %s and logs the cause with the URL', async (code) => {
    const failing = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} host`), { code }) })
    }) as typeof fetch
    const logs: string[] = []
    const dest = join(temp(), 'net.bin.gz')
    await expect(download('https://example.invalid/f.bin', dest, sha(body), { fetch: failing, log: (l) => logs.push(l) })).rejects.toThrow(
      'Нет подключения к интернету или сервер недоступен',
    )
    expect(logs.join('\n')).toContain('https://example.invalid/f.bin')
    expect(logs.join('\n')).toContain(code)
  })

  it('also recognises a bare "fetch failed" and Chromium net errors', async () => {
    for (const msg of ['fetch failed', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_INTERNET_DISCONNECTED']) {
      const failing = (async () => {
        throw new TypeError(msg)
      }) as typeof fetch
      await expect(download('https://example.invalid/f.bin', join(temp(), 'x.bin'), sha(body), { fetch: failing })).rejects.toThrow(
        'Нет подключения к интернету или сервер недоступен',
      )
    }
  })
})
