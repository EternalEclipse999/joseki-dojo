import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadStarts } from '../start'

const list = JSON.parse(readFileSync('packages/server/bases/starts-list.json', 'utf8')) as { positions: { moves: string }[]; branches: { moves: string }[] }
const names = JSON.parse(readFileSync('packages/server/bases/starts-i18n.json', 'utf8')) as Record<string, Record<string, { name?: string; short?: string }>>
const LANGS = ['en', 'zh-Hans', 'zh-Hant', 'ko', 'ja']

describe('starts-i18n.json', () => {
  it('names every position and branch of the shipped list in five languages', () => {
    for (const p of list.positions) for (const l of LANGS) expect(names[p.moves]?.[l], `${p.moves} ${l}`).toMatchObject({ name: expect.any(String), short: expect.any(String) })
    for (const b of list.branches) for (const l of LANGS) expect(names[b.moves]?.[l]?.name, `${b.moves} ${l}`).toEqual(expect.any(String))
  })

  it('has nothing that is not on the list', () => {
    const known = new Set([...list.positions, ...list.branches].map((e) => e.moves))
    expect(Object.keys(names).filter((k) => !known.has(k))).toEqual([])
  })

  it('loads with the shipped base and list: no position or branch skipped, no name untranslated', () => {
    const lines: string[] = []
    const book = loadStarts('packages/server/bases/starts.jdb', 'packages/server/bases/starts-list.json', (l) => void lines.push(l))
    expect(lines).toEqual([])
    expect([book.list().length, book.branches().length]).toEqual([list.positions.length, list.branches.length])
  })
})
