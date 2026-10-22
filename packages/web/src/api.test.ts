import { localize } from '@joseki-dojo/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerProblem, ApiError, deleteCard, failureText, fetchCards, fetchProgress, fetchSettings, rateReview, saveLanguage } from './api'

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

  it('the card calls name what failed: reading, deleting or rating; a card already gone counts as deleted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    expect(failureText(await caught(fetchCards()))).toEqual({ key: 'error.api.cards', params: { status: '500' } })
    expect(failureText(await caught(deleteCard('c1')))).toEqual({ key: 'error.api.deleteCard', params: { status: '500' } })
    expect(failureText(await caught(rateReview(7, 'good')))).toEqual({ key: 'error.api.rateReview', params: { status: '500' } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(deleteCard('c1')).resolves.toBeUndefined()
  })

  it('a re-rating refused because the review is no longer the card’s latest is null, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_latest' }, { status: 409 })))
    await expect(rateReview(7, 'good')).resolves.toBeNull()
  })

  it('a problem answer posts the vertex; KataGo not ready (503) is “unavailable”, any other refusal a keyed error', async () => {
    const answer = { vertex: [15, 3], loss: 0, category: 'exact', best: true }
    const fetch = vi.fn(async () => Response.json(answer))
    vi.stubGlobal('fetch', fetch)
    await expect(answerProblem('c/1', [15, 3])).resolves.toEqual(answer)
    expect(fetch).toHaveBeenCalledWith('/api/cards/c%2F1/answer', expect.objectContaining({ method: 'POST', body: JSON.stringify({ vertex: [15, 3] }) }))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'engine_unavailable' }, { status: 503 })))
    await expect(answerProblem('c1', [15, 3])).resolves.toBe('unavailable')
    for (const status of [400, 404, 409]) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'refused' }, { status })))
      expect(failureText(await caught(answerProblem('c1', [15, 3])))).toEqual({ key: 'error.api.answer', params: { status: String(status) } })
    }
  })

  it('the progress is asked for one colour; a refusal rejects (the start screen then keeps the card marks)', async () => {
    const view = { hasWeights: false, level: '5k', color: 'W', overall: { percent: 0, due: 0 }, positions: {} }
    const fetch = vi.fn(async () => Response.json(view))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchProgress('W')).resolves.toEqual(view)
    expect(fetch).toHaveBeenCalledWith('/api/progress?color=W', undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(fetchProgress('B')).rejects.toThrow('progress: HTTP 500')
  })
})
