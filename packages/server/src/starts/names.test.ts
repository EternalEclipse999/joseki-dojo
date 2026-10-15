import { describe, expect, it } from 'vitest'
import { loadNames, nameFor } from './names'

const json = JSON.stringify({ 'Q16 O17 R14': { en: { name: 'Small approach — knight answer', short: 'Knight answer' } } })

describe('start names', () => {
  it('gives every language, falling back to English, then Russian, and logs what is missing', () => {
    const lines: string[] = []
    const log = (l: string): void => void lines.push(l)
    const names = loadNames(json, log)
    const n = nameFor(names, 'Q16 O17 R14', { name: 'Малое приближение — ответ кэймой', short: 'Ответ кэймой' }, log)
    expect(n.name).toMatchObject({ ru: 'Малое приближение — ответ кэймой', en: 'Small approach — knight answer', ja: 'Small approach — knight answer' })
    expect(n.short?.ko).toBe('Knight answer')
    expect(nameFor(names, 'Q17 R15', { name: 'Тест' }, log).name.en).toBe('Тест')
    expect(lines.filter((l) => l.includes('Q16 O17 R14'))).toHaveLength(1)
  })

  it('takes an empty or non-string translation as missing', () => {
    const lines: string[] = []
    const names = loadNames(JSON.stringify({ 'Q16 O17 R14': { en: { name: 'Knight answer', short: 'Knight' }, ja: { name: '', short: '  ' }, ko: { name: 7 } } }), () => {})
    const n = nameFor(names, 'Q16 O17 R14', { name: 'Ответ кэймой', short: 'Кэйма' }, (l) => void lines.push(l))
    expect([n.name.ja, n.name.ko, n.short?.ja, n.short?.ko]).toEqual(['Knight answer', 'Knight answer', 'Knight', 'Knight'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/ja/)
    expect(lines[0]).toMatch(/ko/)
    const ruOnly = nameFor(loadNames(JSON.stringify({ 'Q17 R15': { en: { name: ' ' } } }), () => {}), 'Q17 R15', { name: 'Тест' })
    expect(ruOnly.name.en).toBe('Тест')
  })

  it('takes a broken or empty file as no translations, with one log line', () => {
    for (const json of ['not json', '[]', '{}']) {
      const lines: string[] = []
      expect(loadNames(json, (l) => void lines.push(l))).toEqual({})
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^Переводы названий стартовых позиций недоступны: /)
    }
  })
})
