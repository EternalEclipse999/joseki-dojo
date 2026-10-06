import type { AppUpdateState } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { UpdateController, type UpdateActions } from './update-controller'

function setup(overrides: Partial<UpdateActions> = {}) {
  const calls: string[] = []
  const states: AppUpdateState[] = []
  const actions: UpdateActions = {
    check: async () => {
      calls.push('check')
    },
    download: async () => {
      calls.push('download')
    },
    install: async () => {
      calls.push('install')
    },
    ...overrides,
  }
  const controller = new UpdateController(actions, (s) => states.push(s))
  return { controller, calls, states }
}

describe('UpdateController', () => {
  it('offers a found version, downloads it only on request and installs it when downloaded', async () => {
    const { controller, calls } = setup()
    expect(controller.current).toEqual({ status: 'idle' })
    await controller.check()
    controller.onAvailable('0.2.0')
    expect(controller.current).toEqual({ status: 'available', version: '0.2.0' })
    expect(calls).toEqual(['check'])

    await controller.download()
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
    controller.onProgress(42.7)
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 42 })

    await controller.onDownloaded('0.2.0')
    expect(controller.current).toEqual({ status: 'installing', version: '0.2.0' })
    expect(calls).toEqual(['check', 'download', 'install'])
  })

  it('does nothing on «Обновить» before a version is found', async () => {
    const { controller, calls } = setup()
    await controller.download()
    expect(calls).toEqual([])
    expect(controller.current).toEqual({ status: 'idle' })
  })

  it('shows a failed check with a retry that checks again; a later quiet check hides it', async () => {
    let online = false
    const { controller, calls } = setup({
      check: async () => {
        calls.push('check')
        if (!online) throw new Error('net::ERR_INTERNET_DISCONNECTED\n    at stack')
      },
    })
    await controller.check()
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось проверить обновления: net::ERR_INTERNET_DISCONNECTED' })
    online = true
    await controller.retry()
    controller.onNotAvailable()
    expect(controller.current).toEqual({ status: 'idle' })
    expect(calls).toEqual(['check', 'check'])
  })

  it('shows a failed download once and downloads again on retry', async () => {
    let fails = true
    const { controller, calls, states } = setup({
      download: async () => {
        calls.push('download')
        if (fails) {
          controller.onError(new Error('socket hang up')) // electron-updater emits the error and rejects
          throw new Error('socket hang up')
        }
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось скачать обновление: socket hang up' })
    expect(states.filter((s) => s.status === 'error')).toHaveLength(1)
    fails = false
    await controller.retry()
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
    expect(calls).toEqual(['download', 'download'])
  })

  it('skips checks while downloading and keeps offering a version when a later check fails', async () => {
    let online = true
    const { controller, calls } = setup({
      check: async () => {
        calls.push('check')
        if (!online) throw new Error('offline')
      },
    })
    controller.onAvailable('0.2.0')
    online = false
    await controller.check()
    expect(controller.current).toEqual({ status: 'available', version: '0.2.0' })
    await controller.download()
    await controller.check()
    expect(calls).toEqual(['check', 'download'])
  })

  it('reports a failed installation', async () => {
    const { controller } = setup({
      install: async () => {
        throw new Error('installer missing')
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    await controller.onDownloaded('0.2.0')
    expect(controller.current).toEqual({ status: 'error', message: 'Не удалось установить обновление: installer missing' })
  })

  it('keeps a download error and its retry when a periodic check finds nothing new', async () => {
    const { controller } = setup({
      download: async () => {
        throw new Error('socket hang up')
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    const error = controller.current
    expect(error).toMatchObject({ status: 'error' })
    await controller.check()
    controller.onNotAvailable()
    expect(controller.current).toEqual(error)
  })

  it('installs once when the downloaded event repeats', async () => {
    const { controller, calls } = setup()
    controller.onAvailable('0.2.0')
    await controller.download()
    await Promise.all([controller.onDownloaded('0.2.0'), controller.onDownloaded('0.2.0')])
    await controller.onDownloaded('0.2.0')
    expect(calls.filter((c) => c === 'install')).toHaveLength(1)
  })

  it('ignores checks, errors and findings while installing', async () => {
    let finish!: () => void
    const { controller, calls, states } = setup({
      install: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    const installing = controller.onDownloaded('0.2.0')
    const before = states.length
    await controller.check()
    controller.onAvailable('0.3.0')
    controller.onNotAvailable()
    controller.onError(new Error('late updater error'))
    controller.onProgress(50)
    expect(controller.current).toEqual({ status: 'installing', version: '0.2.0' })
    expect(states).toHaveLength(before)
    expect(calls).not.toContain('check')
    finish()
    await installing
  })

  it('retries after an install error by downloading and installing again', async () => {
    let fails = true
    const { controller, calls } = setup({
      install: async () => {
        calls.push('install')
        if (fails) throw new Error('installer missing')
      },
    })
    controller.onAvailable('0.2.0')
    await controller.download()
    await controller.onDownloaded('0.2.0')
    expect(controller.current).toMatchObject({ status: 'error', message: expect.stringContaining('установить') })
    fails = false
    await controller.retry()
    expect(controller.current).toEqual({ status: 'downloading', version: '0.2.0', percent: 0 })
    await controller.onDownloaded('0.2.0')
    expect(controller.current).toEqual({ status: 'installing', version: '0.2.0' })
    expect(calls).toEqual(['download', 'install', 'download', 'install'])
  })
})
