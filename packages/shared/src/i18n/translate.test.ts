import { describe, expect, it } from 'vitest'
import { isLanguage, languageFromWindowsId, LANGUAGES } from './languages'
import { isLocalizedText, localize, t, translator } from './translate'

describe('t', () => {
  it('substitutes parameters and leaves an unknown one as it is', () => {
    expect(t('ru', 'error.internal', { detail: 'boom' })).toBe('Внутренняя ошибка: boom')
    expect(t('en', 'error.internal')).toBe('Internal error: {detail}')
  })

  it('picks the plural form by count, Russian and English', () => {
    const ru = (value: string, count: number): string => t('ru', 'common.pointsValue', { value, count })
    expect([ru('1', 1), ru('2', 2), ru('5', 5), ru('1,5', 1.5), ru('21', 21)]).toEqual(['1 очко', '2 очка', '5 очков', '1,5 очка', '21 очко'])
    expect([1, 2].map((count) => t('en', 'common.pointsValue', { value: String(count), count }))).toEqual(['1 point', '2 points'])
    expect(t('ja', 'common.pointsValue', { value: '3', count: 3 })).toBe('3目')
  })

  it('formats numbers in the language and translates nested texts', () => {
    expect(t('ru', 'error.internal', { detail: 1200 })).toBe('Внутренняя ошибка: 1 200')
    expect(t('en', 'error.internal', { detail: 1200 })).toBe('Internal error: 1,200')
    expect(localize('ru', { key: 'error.internal', params: { detail: { key: 'common.pointsValue', params: { value: '2', count: 2 } } } })).toBe('Внутренняя ошибка: 2 очка')
    expect(translator('en')('error.internal', { detail: 'x' })).toBe('Internal error: x')
  })

  it('tells a localized text from other values', () => {
    expect([isLocalizedText({ key: 'error.internal' }), isLocalizedText('text'), isLocalizedText({ key: 1 })]).toEqual([true, false, false])
  })
})

describe('languages', () => {
  it('lists the six languages in menu order', () => {
    expect(LANGUAGES).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja'])
    expect([isLanguage('ko'), isLanguage('fr'), isLanguage(undefined)]).toEqual([true, false, false])
  })

  it('maps Windows language ids, unknown to English', () => {
    expect([1033, 1049, 2052, 1028, 1042, 1041, 1031].map(languageFromWindowsId)).toEqual(['en', 'ru', 'zh-Hans', 'zh-Hant', 'ko', 'ja', 'en'])
  })
})
