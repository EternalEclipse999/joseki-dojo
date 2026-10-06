import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface LockedBuild {
  id: string
  platform: 'win32' | 'linux'
  kind: 'cpu' | 'gpu'
  label: string
  url: string
  sha256: string
}

export interface LockedFile {
  file: string
  url: string
  sha256: string
  size: number
}

export interface KataGoLock {
  katago: { version: string; builds: LockedBuild[] }
  models: { main: LockedFile; human: LockedFile }
}

export const LOCK_FILE = fileURLToPath(new URL('../../../../katago.lock.json', import.meta.url))

const SHA256 = /^[0-9a-f]{64}$/

export function loadLock(file: string = LOCK_FILE): KataGoLock {
  const lock = JSON.parse(readFileSync(file, 'utf8')) as KataGoLock
  if (!/^\d+\.\d+\.\d+$/.test(lock.katago?.version ?? '')) throw new Error(`${file}: katago.version must look like 1.18.1`)
  if (!lock.katago.builds?.length) throw new Error(`${file}: no KataGo builds`)
  if (!lock.models?.main || !lock.models?.human) throw new Error(`${file}: models.main and models.human are required`)
  for (const entry of [...lock.katago.builds, lock.models.main, lock.models.human]) {
    if (!entry.url?.startsWith('https://')) throw new Error(`${file}: url must be https: ${entry.url}`)
    if (!SHA256.test(entry.sha256 ?? '')) throw new Error(`${file}: bad sha256 for ${entry.url}`)
  }
  return lock
}

export const buildsFor = (lock: KataGoLock, platform: string): LockedBuild[] =>
  lock.katago.builds.filter((b) => b.platform === platform)

export function versionWarning(lock: KataGoLock, running: string | null): string | null {
  if (!running || running === lock.katago.version) return null
  return `Запущена KataGo ${running}, а проверена ${lock.katago.version}. Работать будет, но эта версия не проверялась.`
}
