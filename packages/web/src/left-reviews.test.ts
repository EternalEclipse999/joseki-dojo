import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { afterLeaving, afterPoll, leftAnswer, LEFT_REVIEW_WAIT_MS, without, type LeftTraining } from './left-reviews'

const left = (id: string, leftAt = 0): LeftTraining => ({ id, leftAt })

describe('afterLeaving', () => {
  it('remembers a finished training left before its review was ready, and when: back to the start screen or another training', () => {
    expect(afterLeaving([], 'a', null, 7)).toEqual([left('a', 7)])
    expect(afterLeaving([left('a')], 'b', 'c', 9)).toEqual([left('a'), left('b', 9)])
  })

  it('keeps the list as it is while the training is still shown, when nothing was pending, or when it is already there', () => {
    const waiting = [left('a')]
    // The review came (nothing pending now), or the training goes on playing: still the same session on screen.
    expect(afterLeaving(waiting, 'b', 'b', 1)).toBe(waiting)
    expect(afterLeaving(waiting, null, null, 1)).toBe(waiting)
    expect(afterLeaving(waiting, null, 'c', 1)).toBe(waiting)
    expect(afterLeaving(waiting, 'a', null, 1)).toBe(waiting)
  })
})

describe('without', () => {
  it('forgets the trainings named', () => {
    expect(without([left('a'), left('b'), left('c')], ['a', 'c'])).toEqual([left('b')])
    expect(without([left('a')], ['a'])).toEqual([])
  })

  it('keeps the same list when none of them is waiting (a review of a training never left)', () => {
    const waiting = [left('a')]
    expect(without(waiting, ['b'])).toBe(waiting)
    expect(without(waiting, [])).toBe(waiting)
  })
})

describe('leftAnswer', () => {
  const failure = (status: string) => Promise.reject(new ApiError({ key: 'error.api.review', params: { status } }))

  it('tells a ready review, one not ready yet and a session that is gone', async () => {
    expect(await leftAnswer(Promise.resolve({ sessionId: 'a' }))).toBe('ready')
    expect(await leftAnswer(Promise.resolve(null))).toBe('waiting')
    expect(await leftAnswer(failure('404'))).toBe('gone')
  })

  it('asks again after any other failure', async () => {
    expect(await leftAnswer(failure('500'))).toBe('waiting')
    expect(await leftAnswer(Promise.reject(new TypeError('Failed to fetch')))).toBe('waiting')
  })
})

describe('afterPoll', () => {
  it('drops the ready and the gone trainings; a ready one has the counts read again', () => {
    const waiting = [left('a'), left('b'), left('c')]
    expect(afterPoll(waiting, ['ready', 'waiting', 'gone'], 1000)).toEqual({ drop: ['a', 'c'], ready: true })
    expect(afterPoll(waiting, ['gone', 'waiting', 'waiting'], 1000)).toEqual({ drop: ['a'], ready: false })
  })

  it('keeps asking until the wait is over, then drops a review that never came', () => {
    const waiting = [left('a', 0), left('b', 60_000)]
    expect(afterPoll(waiting, ['waiting', 'waiting'], LEFT_REVIEW_WAIT_MS - 1)).toEqual({ drop: [], ready: false })
    expect(afterPoll(waiting, ['waiting', 'waiting'], LEFT_REVIEW_WAIT_MS)).toEqual({ drop: ['a'], ready: false })
    // Asked once more after a long absence: a review ready by then still counts.
    expect(afterPoll(waiting, ['ready', 'waiting'], 3 * LEFT_REVIEW_WAIT_MS)).toEqual({ drop: ['a', 'b'], ready: true })
  })
})
