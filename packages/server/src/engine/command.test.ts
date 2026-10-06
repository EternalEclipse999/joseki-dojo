import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config'
import { engineCommand } from './command'

describe('engineCommand', () => {
  it('builds the analysis command line', () => {
    const k = { path: '/k/katago', analysisConfig: '/k/a.cfg', mainModel: '/k/main.bin.gz', humanModel: '/k/human.bin.gz' }
    expect(engineCommand({ ...DEFAULT_CONFIG, katago: k })).toEqual({
      command: '/k/katago',
      args: ['analysis', '-config', '/k/a.cfg', '-model', '/k/main.bin.gz', '-human-model', '/k/human.bin.gz'],
    })
  })

  it('uses the override when present', () => {
    const katago = { ...DEFAULT_CONFIG.katago, commandOverride: ['/usr/bin/node', '/x/fake.mjs'] }
    expect(engineCommand({ ...DEFAULT_CONFIG, katago })).toEqual({ command: '/usr/bin/node', args: ['/x/fake.mjs'] })
  })
})
