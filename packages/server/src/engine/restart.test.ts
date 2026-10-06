import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_KATAGO, fakeEngine } from '../../test/helpers'
import type { KataGoEngine } from './engine'
import { baseQuery } from './query'

const engines: KataGoEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.stop()))
})

describe('KataGoEngine.restartWith', () => {
  it('switches to another command and keeps answering', async () => {
    const e = fakeEngine()
    engines.push(e)
    e.start()
    expect(await e.version()).toBe('1.18.1')
    await e.restartWith({ command: process.execPath, args: [FAKE_KATAGO], env: { FAKE_KATAGO_VERSION: '1.18.2' } })
    expect(await e.version()).toBe('1.18.2')
    expect(e.failed).toBe(false)
  })

  it('clears a failure', async () => {
    const e = fakeEngine({ FAKE_KATAGO_ALWAYS_CRASH: '1' })
    engines.push(e)
    e.start()
    await expect(e.analyze(baseQuery([]))).rejects.toMatchObject({ code: 'engine_failed' })
    await e.restartWith({ command: process.execPath, args: [FAKE_KATAGO] })
    expect(e.failed).toBe(false)
    expect((await e.analyze(baseQuery([]))).moveInfos[0].move).toBe('D4')
  })
})
