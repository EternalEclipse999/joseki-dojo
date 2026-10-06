import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeEngine, tempDir } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

const engines: KataGoEngine[] = []
const track = (e: KataGoEngine): KataGoEngine => {
  engines.push(e)
  e.start()
  return e
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('KataGoEngine', () => {
  it('reports the version', async () => {
    expect(await track(fakeEngine()).version()).toBe('1.18.1')
  })

  it('matches concurrent replies by id', async () => {
    const e = track(fakeEngine())
    const [a, b] = await Promise.all([
      e.analyze({ ...baseQuery([]), maxVisits: 10 }),
      e.analyze({ ...baseQuery([{ color: 'B', vertex: [3, 15] }]), maxVisits: 20 }),
    ])
    expect(a.rootInfo.visits).toBe(10)
    expect(a.moveInfos[0].move).toBe('D4')
    expect(b.rootInfo.visits).toBe(20)
    expect(b.moveInfos[0].move).toBe('Q4')
  })

  it('rejects a query KataGo answers with an error', async () => {
    const e = track(fakeEngine())
    await expect(e.analyze({ ...baseQuery([]), rules: 'invalid' })).rejects.toMatchObject({ code: 'query_error' })
  })

  it('restarts after a crash and resends the pending query', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({ FAKE_KATAGO_CRASH_ONCE_FILE: join(tempDir(), 'crashed') }, logs))
    const r = await e.analyze(baseQuery([]))
    expect(r.moveInfos[0].move).toBe('D4')
    expect(logs.some((l) => l.includes('crash #1'))).toBe(true)
    expect(e.failed).toBe(false)
  })

  it('gives up after repeated crashes and recovers on reset', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_ALWAYS_CRASH: '1' }))
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    expect(e.failed).toBe(true)
    expect(e.failure).toContain('аварийно')
    await expect(e.version()).rejects.toMatchObject({ code: 'engine_failed' })
    e.reset()
    expect(e.failed).toBe(false)
    expect(await e.version()).toBe('1.18.1')
  })

  it('stays stopped after stop() until started again', async () => {
    const e = track(fakeEngine())
    await e.stop()
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    e.start()
    expect(await e.version()).toBe('1.18.1')
  })

  it('does not count the exit of a stopped process as a crash', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({}, logs))
    await e.version()
    const s = e.stop()
    e.start()
    await s
    expect(await e.version()).toBe('1.18.1')
    expect(logs.some((l) => l.includes('crash'))).toBe(false)
  })

  it('rejects a query the running KataGo never answers, then restarts it', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_HANG: '1' }, [], { queryTimeoutMs: 300, watchdogIntervalMs: 50 }))
    await e.version()
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({
      code: 'engine_failed',
      message: expect.stringContaining('не ответил'),
    })
    expect(await e.version()).toBe('1.18.1')
  })

  it('does not time out queries that merely wait in KataGo queue', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({ FAKE_KATAGO_DELAY_MS: '100' }, logs, { queryTimeoutMs: 600, watchdogIntervalMs: 50 }))
    await e.version()
    const results = await Promise.all(Array.from({ length: 6 }, () => e.analyze(baseQuery([]))))
    expect(results).toHaveLength(6)
    expect(logs.some((l) => l.includes('не ответил') || l.includes('crash'))).toBe(false)
  })

  it('rejects a query when KataGo never answers after startup', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_SILENT: '1' }, [], { startupTimeoutMs: 300, watchdogIntervalMs: 50 }))
    await expect(e.version()).rejects.toMatchObject({ code: 'engine_failed' })
  })
})
