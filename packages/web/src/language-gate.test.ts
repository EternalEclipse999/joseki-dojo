import { describe, expect, it } from 'vitest'
import { needsLanguageScreen } from './language-gate'

describe('needsLanguageScreen', () => {
  it('asks for a language only while the settings have none (null: not known yet — wait)', () => {
    expect([needsLanguageScreen(false), needsLanguageScreen(true), needsLanguageScreen(null)]).toEqual([true, false, false])
  })
})
