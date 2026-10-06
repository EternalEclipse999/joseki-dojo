import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vertexToIndex, type Move } from '@joseki-dojo/shared'
import { loadConfig } from '../src/config'
import { engineCommand } from '../src/engine/command'
import { KataGoEngine } from '../src/engine/engine'
import { checkEngine } from '../src/engine/health'
import { loadLock } from '../src/engine/lock'
import { baseQuery } from '../src/engine/query'

const CONFIG_FILE = fileURLToPath(new URL('../../../config.local.json', import.meta.url))
const configured = existsSync(CONFIG_FILE)

describe.skipIf(!configured)('real KataGo', () => {
  const config = configured ? loadConfig(CONFIG_FILE) : null
  let withHuman: KataGoEngine
  let plain: KataGoEngine

  beforeAll(() => {
    const cmd = engineCommand(config!)
    withHuman = new KataGoEngine(cmd)
    // Same command without the trailing `-human-model <file>`.
    plain = new KataGoEngine({ command: cmd.command, args: cmd.args.slice(0, -2) })
    withHuman.start()
    plain.start()
  })

  afterAll(async () => {
    await withHuman.stop()
    await plain.stop()
  })

  it('passes the startup checks', async () => {
    expect(await checkEngine(config!, withHuman)).toEqual({ state: 'ready', reason: null })
  })

  it('runs the KataGo version pinned in katago.lock.json', async () => {
    expect(await withHuman.version()).toBe(loadLock().katago.version)
  })

  it('reports score and ownership from Black’s point of view even with White to move', async () => {
    const moves: Move[] = [
      { color: 'B', vertex: [3, 15] },
      { color: 'W', vertex: [15, 3] },
      { color: 'B', vertex: [3, 3] },
    ]
    const r = await withHuman.analyze({ ...baseQuery(moves), maxVisits: 100, includeOwnership: true })
    expect(r.rootInfo.currentPlayer).toBe('W')
    expect(r.ownership![vertexToIndex([3, 15])]).toBeGreaterThan(0.3)
    expect(r.ownership![vertexToIndex([15, 3])]).toBeLessThan(-0.3)
  })

  it('returns a normalized human policy with occupied points marked illegal', async () => {
    const r = await withHuman.analyze({
      ...baseQuery([{ color: 'B', vertex: [15, 3] }]),
      maxVisits: 1,
      includePolicy: true,
      overrideSettings: { humanSLProfile: 'rank_7k' },
    })
    expect(r.humanPolicy).toHaveLength(362)
    expect(r.humanPolicy![vertexToIndex([15, 3])]).toBe(-1)
    expect(r.humanPolicy!.filter((p) => p > 0).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)
  })

  // Spec 6.5: loading -human-model must not change plain analysis beyond search noise.
  it('gives the same plain analysis with and without the human model', async () => {
    const q = { ...baseQuery([{ color: 'B', vertex: [15, 3] }, { color: 'W', vertex: [16, 5] }]), maxVisits: config!.analysis.reviewVisits }
    const meanLead = async (e: KataGoEngine): Promise<number> => {
      let sum = 0
      for (let i = 0; i < 3; i++) sum += (await e.analyze(q)).rootInfo.scoreLead
      return sum / 3
    }
    const withModel = await meanLead(withHuman)
    const without = await meanLead(plain)
    expect(Math.abs(withModel - without)).toBeLessThan(1)
  })
})
