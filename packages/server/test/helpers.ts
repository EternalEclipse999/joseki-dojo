import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CONFIG, type AppConfig } from '../src/config'
import { KataGoEngine, type EngineOptions } from '../src/engine/engine'

export const FAKE_KATAGO = fileURLToPath(new URL('./fake-katago.mjs', import.meta.url))

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'joseki-dojo-'))

export function fakeEngine(env: Record<string, string> = {}, logs: string[] = [], options: EngineOptions = {}): KataGoEngine {
  return new KataGoEngine({ command: process.execPath, args: [FAKE_KATAGO], env }, (line) => logs.push(line), options)
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    dataDir: tempDir(),
    katago: { ...DEFAULT_CONFIG.katago, commandOverride: [process.execPath, FAKE_KATAGO] },
    analysis: { reviewVisits: 10, endVisits: 5 },
    ...overrides,
  }
}
