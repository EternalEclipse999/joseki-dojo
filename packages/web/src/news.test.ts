import { describe, expect, it } from 'vitest'
import { afterAction, fromStartup, NO_NEWS } from './news'

describe('news state', () => {
  it('the startup load sets the marks and the callout', () => {
    expect(fromStartup({ unseen: ['repetition'], callout: 'repetition' })).toEqual({ unseen: ['repetition'], callout: 'repetition' })
    expect(NO_NEWS).toEqual({ unseen: [], callout: null })
  })

  it('before the answer: seen drops the mark and the callout, dismiss only the callout', () => {
    const shown = { unseen: ['repetition' as const], callout: 'repetition' as const }
    expect(afterAction(shown, 'repetition', 'seen', null)).toEqual({ unseen: [], callout: null })
    expect(afterAction(shown, 'repetition', 'dismiss', null)).toEqual({ unseen: ['repetition'], callout: null })
  })

  it('the answer sets the marks; a callout in it is not shown in this run', () => {
    const shown = { unseen: ['repetition' as const], callout: null }
    expect(afterAction(shown, 'repetition', 'dismiss', { unseen: ['repetition'], callout: 'repetition' })).toEqual({ unseen: ['repetition'], callout: null })
  })
})
