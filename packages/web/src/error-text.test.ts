import { describe, expect, it } from 'vitest'
import { errorText } from './error-text'

describe('errorText', () => {
  it('shows the same server error in the current language', () => {
    const error = { key: 'error.starts.notOnList' } as const
    expect(errorText(error, 'ru')).toBe('Такой позиции нет в списке')
    expect(errorText(error, 'en')).toBe('This position is not on the list')
  })
})
