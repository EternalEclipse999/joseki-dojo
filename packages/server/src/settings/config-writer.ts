import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renameRetrying } from '../install/download'

/** One queue per config file: writes of the settings and of the interface preferences must not overwrite each other. */
const queues = new Map<string, Promise<void>>()
let counter = 0

/**
 * Read-modify-write of a JSON config file, one write at a time per file. The file is replaced through a unique
 * temp file, so a reader never sees a half-written config. A failed write does not block the ones queued behind it.
 */
export function updateConfigFile(file: string, mutate: (raw: Record<string, unknown>) => void): Promise<void> {
  const key = resolve(file)
  const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const raw = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as Record<string, unknown>
    mutate(raw)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${++counter}.tmp`
    try {
      writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
      await renameRetrying(tmp, file)
    } catch (err) {
      rmSync(tmp, { force: true })
      throw err
    }
  })
  const tail = run.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}
