import { localize } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, failureText, fetchSettings, saveLanguage } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

const caught = (call: Promise<unknown>): Promise<unknown> => call.catch((e: unknown) => e)

describe('API errors', () => {
  it('a failed request throws its text as a key with the status, shown in the reader’s language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const error = await caught(fetchSettings())
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).text).toEqual({ key: 'error.api.settings', params: { status: '503' } })
    expect(localize('ru', failureText(error))).toBe('Не удалось загрузить настройки: HTTP 503')
    expect(localize('en', failureText(error))).toBe('Could not load the settings: HTTP 503')
  })

  it('a failed language save is a keyed error too, so that the banner can show it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const error = await caught(saveLanguage('ko'))
    expect(error).toBeInstanceOf(ApiError)
    expect(failureText(error)).toEqual({ key: 'error.api.saveUi', params: { status: '500' } })
  })

  it('a fetch that never reached the server is a lost connection, shown in the reader’s language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    for (const call of [fetchSettings(), saveLanguage('en')]) {
      const error = await caught(call)
      expect(error).toBeInstanceOf(ApiError)
      expect(failureText(error)).toEqual({ key: 'error.network' })
    }
    const error = await caught(fetchSettings())
    expect(localize('ru', failureText(error))).toBe('Нет связи с сервером')
    expect(localize('en', failureText(error))).toBe('No connection to the server')
  })

  it('a TypeError from anywhere else (a bug after the answer) is an internal error, not a lost connection', async () => {
    const answer = { ok: true, status: 200, json: async (): Promise<never> => Promise.reject(new TypeError('settings is undefined')) }
    vi.stubGlobal('fetch', vi.fn(async () => answer as unknown as Response))
    expect(failureText(await caught(fetchSettings()))).toEqual({ key: 'error.internal', params: { detail: 'settings is undefined' } })
    expect(failureText(new TypeError('Failed to fetch'))).toEqual({ key: 'error.internal', params: { detail: 'Failed to fetch' } })
  })

  it('any other error is an internal one with its message', () => {
    expect(failureText(new Error('boom'))).toEqual({ key: 'error.internal', params: { detail: 'boom' } })
    expect(failureText('oops')).toEqual({ key: 'error.internal', params: { detail: 'oops' } })
  })
})
