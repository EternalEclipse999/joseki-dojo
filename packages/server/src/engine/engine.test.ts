import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FAKE_KATAGO, fakeEngine, tempDir } from '../../test/helpers'
import { KataGoEngine } from './engine'
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

describe('analyzeStream', () => {
  const query = { ...baseQuery([]), maxVisits: 100 }
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('delivers growing partial answers and then resolves with the final one', async () => {
    const e = track(fakeEngine())
    const visits: number[] = []
    const stream = e.analyzeStream(query, (p) => visits.push(p.rootInfo.visits), 0.02)
    const final = await stream.done
    expect(visits).toEqual([25, 50, 75])
    expect(final?.isDuringSearch).toBe(false)
    expect(final?.rootInfo.visits).toBe(100)
  })

  it('stop() after a partial answer settles done with it and silences the stream', async () => {
    const e = track(fakeEngine())
    const visits: number[] = []
    let stream!: ReturnType<typeof e.analyzeStream>
    const first = new Promise<void>((resolve) => {
      stream = e.analyzeStream(query, (p) => {
        visits.push(p.rootInfo.visits)
        resolve()
      }, 0.02)
    })
    await first
    stream.stop()
    stream.stop()
    expect((await stream.done)?.rootInfo.visits).toBe(25)
    await sleep(200)
    expect(visits).toEqual([25])
    expect(e.pendingCount).toBe(0)
  })

  it('stop() makes KataGo terminate that very query', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({}, logs))
    await e.analyze({ ...baseQuery([]), maxVisits: 1 }) // q1
    const stream = e.analyzeStream(query, () => {}, 5) // q2
    stream.stop()
    await vi.waitFor(() => expect(logs).toContain('terminate q2'))
    expect(logs).not.toContain('terminate q1')
    e.analyzeStream(query, () => {}, 5).done.catch(() => {}) // q3 is left running: no terminate for it
    await sleep(100)
    expect(logs.filter((l) => l.startsWith('terminate'))).toEqual(['terminate q2'])
  })

  it('stop() before any partial answer settles done with null', async () => {
    const e = track(fakeEngine())
    const stream = e.analyzeStream(query, () => {}, 0.5)
    stream.stop()
    expect(await stream.done).toBeNull()
  })

  it('rejects when KataGo rejects the query', async () => {
    const e = track(fakeEngine())
    const stream = e.analyzeStream({ ...query, rules: 'invalid' }, () => {}, 0.02)
    await expect(stream.done).rejects.toMatchObject({ code: 'query_error' })
  })

  it('fails a running stream after a crash instead of resending it, but still answers a plain query', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_CRASH_ONCE_FILE: join(tempDir(), 'crashed') }))
    const stream = e.analyzeStream(query, () => {}, 0.02)
    const plain = e.analyze(baseQuery([]))
    await expect(stream.done).rejects.toMatchObject({ code: 'engine_failed' })
    expect((await plain).moveInfos[0].move).toBe('D4')
  })

  it('settles done with null when KataGo ends the query with noResults and no partial answer came', async () => {
    const e = track(fakeEngine())
    const stream = e.analyzeStream({ ...query, maxVisits: 0 }, () => {}, 0.02)
    expect(await stream.done).toBeNull()
    expect(e.pendingCount).toBe(0)
  })

  it('rejects a stream with the right text: stopped, failed for good, restarted', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_ALWAYS_CRASH: '1' }))
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    await expect(e.analyzeStream(query, () => {}, 0.02).done).rejects.toMatchObject({
      code: 'engine_failed',
      message: expect.stringContaining('аварийно'),
    })
    const s = track(fakeEngine({ FAKE_KATAGO_CRASH_ONCE_FILE: join(tempDir(), 'crashed') }))
    await expect(s.analyzeStream(query, () => {}, 0.02).done).rejects.toMatchObject({ message: 'KataGo перезапущен' })
    await s.stop()
    await expect(s.analyzeStream(query, () => {}, 0.02).done).rejects.toMatchObject({
      code: 'engine_failed',
      message: 'KataGo остановлен',
    })
    const t = track(fakeEngine())
    const running = t.analyzeStream(query, () => {}, 5)
    const rejected = expect(running.done).rejects.toMatchObject({ message: 'KataGo остановлен' })
    await t.stop()
    await rejected
  })

  it('rejects a running stream on restartWith instead of resending it', async () => {
    const e = track(fakeEngine())
    const stream = e.analyzeStream(query, () => {}, 5)
    const restarted = e.restartWith({ command: process.execPath, args: [FAKE_KATAGO] })
    await expect(stream.done).rejects.toMatchObject({ code: 'engine_failed', message: 'KataGo перезапущен' })
    await restarted
    expect(e.pendingCount).toBe(0)
    expect(await e.version()).toBe('1.18.1')
  })

  it('keeps streaming when the onUpdate callback throws, and logs it', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({}, logs))
    const stream = e.analyzeStream(query, () => {
      throw new Error('boom')
    }, 0.02)
    expect((await stream.done)?.rootInfo.visits).toBe(100)
    expect(logs.filter((l) => l.includes('boom'))).toHaveLength(3)
  })

  it('does not trip the hang watchdog while partial answers keep arriving', async () => {
    const logs: string[] = []
    const e = track(fakeEngine({}, logs, { queryTimeoutMs: 300, watchdogIntervalMs: 50 }))
    const stream = e.analyzeStream(query, () => {}, 0.1) // the whole search takes 400 ms, longer than the timeout
    expect((await stream.done)?.rootInfo.visits).toBe(100)
    expect(logs.some((l) => l.includes('не ответил'))).toBe(false)
  })
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

  it('measures the startup timeout from the first query, not from the spawn of an idle process', async () => {
    const e = track(fakeEngine({ FAKE_KATAGO_HANG: '1' }, [], { startupTimeoutMs: 400, watchdogIntervalMs: 50 }))
    await new Promise((r) => setTimeout(r, 600))
    const sent = Date.now()
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    expect(Date.now() - sent).toBeGreaterThanOrEqual(300)
  })

  it('treats a synchronous spawn failure as a crash instead of throwing', async () => {
    const logs: string[] = []
    const e = new KataGoEngine({ command: 'bad\0command', args: [] }, (l) => logs.push(l))
    engines.push(e)
    expect(() => e.start()).not.toThrow()
    await expect(e.version()).rejects.toMatchObject({ code: 'engine_failed' })
    expect(e.failed).toBe(true)
    expect(e.pendingCount).toBe(0)
    e.reset()
    expect(e.failed).toBe(true) // still the same bad command
    await e.restartWith({ command: process.execPath, args: [FAKE_KATAGO] })
    expect(e.failed).toBe(false)
    expect(await e.version()).toBe('1.18.1')
  })
})
