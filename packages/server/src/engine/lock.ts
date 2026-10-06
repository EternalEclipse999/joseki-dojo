import { readFileSync } from 'node:fs'

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

const SHA256 = /^[0-9a-f]{64}$/

/** Reads and checks katago.lock.json; the caller says where it is (the repository root, or the desktop app's resources). */
export function loadLock(file: string): KataGoLock {
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

/** Spec 5.1: names the pinned KataGo version and networks: `<version>/<main sha256, 12>/<human sha256, 12>`. */
export const lockId = (lock: KataGoLock): string =>
  `${lock.katago.version}/${lock.models.main.sha256.slice(0, 12)}/${lock.models.human.sha256.slice(0, 12)}`
