import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { download, findKatagoBinary, sha256File } from './download'

const temp = (): string => mkdtempSync(join(tmpdir(), 'joseki-setup-'))
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const closers: (() => Promise<void>)[] = []

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

  it('downloads a file and verifies its checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await download(await serve(body), dest, sha(body), () => undefined)
    expect(readFileSync(dest)).toEqual(body)
    expect(await sha256File(dest)).toBe(sha(body))
  })

  it('rejects a wrong checksum and leaves nothing behind', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(await serve(body), dest, sha(Buffer.from('other')), () => undefined)).rejects.toThrow(/SHA-256/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('re-checks an existing file instead of downloading it', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, body)
    const logs: string[] = []
    await download('https://invalid.example/never-fetched', dest, sha(body), (l) => logs.push(l))
    expect(logs).toEqual(['Уже скачано и проверено: net.bin.gz'])
  })

  it('refuses an existing file with a different checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    writeFileSync(dest, 'tampered')
    await expect(download('https://invalid.example/never-fetched', dest, sha(body), () => undefined)).rejects.toThrow(/katago\.lock\.json/)
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
    await expect(download(url, dest, sha(body), () => undefined)).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('names the URL when the connection is refused', async () => {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    const url = `http://127.0.0.1:${port}/file.bin`
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), () => undefined)).rejects.toThrow(url)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts a stalled download and leaves no partial file', async () => {
    const url = await serveRaw((_req, res) => {
      res.writeHead(200, { 'content-length': 1000 })
      res.write(body)
    })
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), () => undefined, 300)).rejects.toThrow(/завис/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('aborts when headers never arrive', async () => {
    const url = await serveRaw(() => undefined)
    const dest = join(temp(), 'net.bin.gz')
    await expect(download(url, dest, sha(body), () => undefined, 300)).rejects.toThrow(/завис/)
  })

  it('accepts an upper-case checksum', async () => {
    const dest = join(temp(), 'net.bin.gz')
    await download(await serve(body), dest, sha(body).toUpperCase(), () => undefined)
    expect(existsSync(dest)).toBe(true)
  })
})

describe('findKatagoBinary', () => {
  it('finds the executable in nested folders', () => {
    const dir = temp()
    const nested = join(dir, 'katago-v1.18.1', 'bin')
    mkdirSync(nested, { recursive: true })
    const name = process.platform === 'win32' ? 'katago.exe' : 'katago'
    writeFileSync(join(nested, name), '')
    expect(findKatagoBinary(dir)).toBe(join(nested, name))
    expect(findKatagoBinary(temp())).toBeNull()
  })
})
