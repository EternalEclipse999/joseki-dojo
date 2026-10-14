import { describe, expect, it } from 'vitest'
import { pickLanguage } from './i18n'

describe('pickLanguage', () => {
  it('takes the saved language, else the remembered one', () => {
    expect(pickLanguage({ theme: 'system', language: 'ja' }, 'ru')).toEqual({ language: 'ja', chosen: true })
    expect(pickLanguage({ theme: 'system' }, 'ru')).toEqual({ language: 'ru', chosen: false })
  })
})
