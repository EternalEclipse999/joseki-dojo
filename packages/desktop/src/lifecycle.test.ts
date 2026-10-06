import { describe, expect, it, vi } from 'vitest'
import { runInstall, sameOrigin, withTimeout } from './lifecycle'

function steps(over: Partial<Parameters<typeof runInstall>[0]> = {}) {
  const calls: string[] = []
  const deps: Parameters<typeof runInstall>[0] = {
    arm: () => calls.push('arm'),
    disarm: () => calls.push('disarm'),
    close: async () => {
      calls.push('close')
    },
    quitAndInstall: () => calls.push('quitAndInstall'),
    restart: () => calls.push('restart'),
    closeTimeoutMs: 50,
    ...over,
  }
  return { calls, deps }
}

describe('runInstall', () => {
  it('arms the watchdog before closing, then hands over to the installer', async () => {
    const { calls, deps } = steps()
    await runInstall(deps)
    expect(calls).toEqual(['arm', 'close', 'quitAndInstall'])
  })

  it('restarts the app when closing fails', async () => {
    const { calls, deps } = steps({ close: async () => Promise.reject(new Error('boom')) })
    await expect(runInstall(deps)).rejects.toThrow('boom')
    expect(calls).toEqual(['arm', 'disarm', 'restart'])
  })

  it('restarts the app when quitAndInstall throws synchronously', async () => {
    const { calls, deps } = steps({
      quitAndInstall: () => {
        throw new Error('no installer')
      },
    })
    await expect(runInstall(deps)).rejects.toThrow('no installer')
    expect(calls).toEqual(['arm', 'close', 'disarm', 'restart'])
  })

  it('goes on to the installer when closing takes longer than the timeout', async () => {
    const { calls, deps } = steps({ close: () => new Promise<void>(() => undefined) })
    await runInstall(deps)
    expect(calls).toEqual(['arm', 'quitAndInstall'])
  })
})

describe('withTimeout', () => {
  it('tells whether the promise finished in time', async () => {
    expect(await withTimeout(Promise.resolve(), 50)).toBe(true)
    expect(await withTimeout(new Promise<void>(() => undefined), 20)).toBe(false)
    vi.useRealTimers()
  })
})

describe('sameOrigin', () => {
  it('compares origins, not prefixes', () => {
    const o = 'http://127.0.0.1:5000'
    expect(sameOrigin('http://127.0.0.1:5000/play?x=1', o)).toBe(true)
    expect(sameOrigin('http://127.0.0.1:50001/', o)).toBe(false)
    expect(sameOrigin('http://127.0.0.1:5000.evil.com/', o)).toBe(false)
    expect(sameOrigin('http://127.0.0.1:5000@evil.com/', o)).toBe(false)
    expect(sameOrigin('not a url', o)).toBe(false)
    expect(sameOrigin('', o)).toBe(false)
  })
})
