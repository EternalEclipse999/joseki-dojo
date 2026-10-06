import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_LOCK, tempDir } from '../../test/helpers'
import { HUMAN_MODEL_FILE, MAIN_MODEL_FILE } from '../config'
import { buildsFor, loadLock, lockId, versionWarning } from './lock'

describe('katago.lock.json', () => {
  it('pins one KataGo version with builds for Windows and Linux', () => {
    const lock = loadLock(REPO_LOCK)
    expect(lock.katago.version).toBe('1.18.1')
    expect(buildsFor(lock, 'win32').map((b) => b.id)).toEqual(['eigenavx2', 'opencl', 'cuda'])
    expect(buildsFor(lock, 'linux').map((b) => b.id)).toEqual(['eigenavx2', 'opencl', 'cuda'])
    expect(buildsFor(lock, 'darwin')).toEqual([])
    for (const b of lock.katago.builds) expect(b.url).toContain(`/v${lock.katago.version}/katago-v${lock.katago.version}-`)
  })

  it('names the same networks as the config defaults', () => {
    const lock = loadLock(REPO_LOCK)
    expect(lock.models.main.file).toBe(MAIN_MODEL_FILE)
    expect(lock.models.human.file).toBe(HUMAN_MODEL_FILE)
  })

  it('rejects a malformed lock', () => {
    const lock = loadLock(REPO_LOCK)
    const file = join(tempDir(), 'lock.json')
    writeFileSync(file, JSON.stringify({ ...lock, katago: { ...lock.katago, builds: [{ ...lock.katago.builds[0], sha256: 'abc' }] } }))
    expect(() => loadLock(file)).toThrow(/sha256/)
  })

  it('warns only about a different running version', () => {
    const lock = loadLock(REPO_LOCK)
    expect(versionWarning(lock, null)).toBeNull()
    expect(versionWarning(lock, '1.18.1')).toBeNull()
    expect(versionWarning(lock, '1.17.2')).toBe('Запущена KataGo 1.17.2, а проверена 1.18.1. Работать будет, но эта версия не проверялась.')
  })
})

describe('lockId', () => {
  it('names the KataGo version and both networks by their checksums', () => {
    expect(lockId(loadLock(REPO_LOCK))).toBe('1.18.1/9d7a6afed8ff/637746e44f0e')
  })
})
