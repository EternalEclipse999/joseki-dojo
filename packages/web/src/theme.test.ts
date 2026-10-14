import { translator } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { resolveTheme, THEME_OPTIONS } from './theme'

describe('resolveTheme', () => {
  it('follows the system only for «Как в системе»', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('THEME_OPTIONS', () => {
  it('lists the themes in the settings order with their labels', () => {
    const t = translator('ru')
    expect(THEME_OPTIONS.map((o) => [o.value, t(o.label)])).toEqual([
      ['system', 'Как в системе'],
      ['light', 'Светлая'],
      ['dark', 'Тёмная'],
    ])
    expect(THEME_OPTIONS.map((o) => translator('en')(o.label))).toEqual(['System', 'Light', 'Dark'])
  })
})
