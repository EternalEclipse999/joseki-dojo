import { localize } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, failureText, fetchSettings } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API errors', () => {
  it('a failed request throws its text as a key with the status, shown in the reader’s language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const error = await fetchSettings().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).text).toEqual({ key: 'error.api.settings', params: { status: '503' } })
    expect(localize('ru', failureText(error))).toBe('Не удалось загрузить настройки: HTTP 503')
    expect(localize('en', failureText(error))).toBe('Could not load the settings: HTTP 503')
  })

  it('any other error is an internal one with its message', () => {
    expect(failureText(new TypeError('Failed to fetch'))).toEqual({ key: 'error.internal', params: { detail: 'Failed to fetch' } })
  })
})
