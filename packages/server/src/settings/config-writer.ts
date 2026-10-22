import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renameRetrying, renameRetryingSync } from '../install/download'

type Mutate = (raw: Record<string, unknown>) => void

/** One queue per config file: writes of the settings and of the interface preferences must not overwrite each other. */
const queues = new Map<string, Promise<void>>()
let counter = 0

/** Runs `task` in the file's turn, after every write queued before it. A failed task does not block the ones queued behind it. */
export function inConfigTurn<T>(file: string, task: () => T | Promise<T>): Promise<T> {
  const key = resolve(file)
  const run = (queues.get(key) ?? Promise.resolve()).then(task)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

/** The mutated config, written to a unique temp file next to `file`; returns the temp file. */
function writeTemp(file: string, mutate: Mutate): string {
  const raw = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as Record<string, unknown>
  mutate(raw)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${++counter}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
  return tmp
}

/**
 * Read-modify-write of a JSON config file, one write at a time per file. The file is replaced through a unique
 * temp file, so a reader never sees a half-written config. A failed write does not block the ones queued behind it.
 */
export function updateConfigFile(file: string, mutate: Mutate): Promise<void> {
  return inConfigTurn(file, async () => {
    const tmp = writeTemp(file, mutate)
    try {
      await renameRetrying(tmp, file)
    } catch (err) {
      rmSync(tmp, { force: true })
      throw err
    }
  })
}

/**
 * The same read-modify-write, synchronous, for a write that must happen inside a database transaction (spec progress
 * part 2, 5). Call it in the file's turn (inConfigTurn), so that it does not interleave with a queued write.
 */
export function updateConfigFileSync(file: string, mutate: Mutate): void {
  const tmp = writeTemp(file, mutate)
  try {
    renameRetryingSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
