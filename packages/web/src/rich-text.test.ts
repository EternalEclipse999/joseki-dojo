import { translator } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { richText } from './rich-text'

describe('richText', () => {
  it('puts markup where the translation has its slot', () => {
    const bold = { type: 'b', move: 'Q16' }
    expect(richText(translator('ru')('review.variationMove', { n: 3 }), { move: bold })).toEqual(['Ход 3: ', bold, ''])
    expect(richText(translator('ja')('variation.line', { n: 2 }), { moves: bold })).toEqual(['2手目からの変化：', bold, ''])
  })

  it('keeps a slot it has no markup for', () => {
    expect(richText('{a} и {b}', { a: 'x' })).toEqual(['', 'x', ' и ', '{b}', ''])
    expect(richText('{toString}', {})).toEqual(['', '{toString}', ''])
  })
})
