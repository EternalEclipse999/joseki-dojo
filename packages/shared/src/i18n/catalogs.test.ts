import { describe, expect, it } from 'vitest'
import { CATALOGS } from './catalogs'
import { LANGUAGES } from './languages'
import type { Message } from './message'
import { ru } from './ru'

const params = (m: Message): string[] => {
  const texts = typeof m === 'string' ? [m] : Object.values(m)
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort()
}

describe('dictionaries', () => {
  const keys = Object.keys(ru).sort()
  for (const lang of LANGUAGES) {
    const catalog = CATALOGS[lang] as Record<string, Message>
    it(`${lang} has exactly the keys of ru`, () => {
      expect(Object.keys(catalog).sort()).toEqual(keys)
    })
    it(`${lang} keeps the parameters of every message`, () => {
      for (const key of keys) expect(params(catalog[key]), key).toEqual(params((ru as Record<string, Message>)[key]))
    })
    it(`${lang} gives every plural form its language can pick`, () => {
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories
      for (const key of keys) {
        const m = catalog[key]
        const model = (ru as Record<string, Message>)[key]
        expect(typeof m === 'string', key).toBe(typeof model === 'string')
        if (typeof m !== 'string') for (const c of categories) expect(m[c], `${key}.${c}`).toBeTypeOf('string')
      }
    })
    it(`${lang} has no empty message`, () => {
      for (const key of keys) {
        const m = catalog[key]
        for (const s of typeof m === 'string' ? [m] : Object.values(m)) expect(s.trim(), key).not.toBe('')
      }
    })
  }
})
