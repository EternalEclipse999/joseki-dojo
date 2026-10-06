import { describe, expect, it } from 'vitest'
import { defaultKind, parseCpuAnswer, parseSourceAnswer, setupRecord } from './build-kind'

describe('defaultKind', () => {
  it('prefers the stored kind', () => {
    expect(defaultKind('cpu', 'C:/x/katago.exe')).toBe('cpu')
    expect(defaultKind('gpu', 'C:/x/katago-eigen/katago.exe')).toBe('gpu')
  })
  it('infers cpu from an eigen path when nothing is stored', () => {
    expect(defaultKind(undefined, 'C:/engines/katago-v1-eigen/katago.exe')).toBe('cpu')
    expect(defaultKind('bogus', 'C:/engines/KataGo-Eigen/katago.exe')).toBe('cpu')
  })
  it('defaults to gpu otherwise', () => {
    expect(defaultKind(undefined, 'C:/engines/katago-opencl/katago.exe')).toBe('gpu')
  })
})

describe('parseCpuAnswer', () => {
  it('uses the default on empty input', () => {
    expect(parseCpuAnswer('', 'cpu')).toBe('cpu')
    expect(parseCpuAnswer('  ', 'gpu')).toBe('gpu')
  })
  it('understands y and n', () => {
    expect(parseCpuAnswer('y', 'gpu')).toBe('cpu')
    expect(parseCpuAnswer('Y', 'gpu')).toBe('cpu')
    expect(parseCpuAnswer('n', 'cpu')).toBe('gpu')
    expect(parseCpuAnswer('N', 'cpu')).toBe('gpu')
  })
  it('falls back to the default on anything else', () => {
    expect(parseCpuAnswer('maybe', 'cpu')).toBe('cpu')
  })
})

describe('parseSourceAnswer', () => {
  it('downloads when nothing is known and nothing is typed', () => {
    expect(parseSourceAnswer('', null)).toEqual({ action: 'download' })
  })
  it('keeps the known path on an empty answer', () => {
    expect(parseSourceAnswer('', 'C:/k/katago.exe')).toEqual({ action: 'known', path: 'C:/k/katago.exe' })
  })
  it('opens the download menu on "скачать" even when a path is known, in any case', () => {
    expect(parseSourceAnswer('скачать', 'C:/k/katago.exe')).toEqual({ action: 'download' })
    expect(parseSourceAnswer('  Скачать ', 'C:/k/katago.exe')).toEqual({ action: 'download' })
    expect(parseSourceAnswer('СКАЧАТЬ', null)).toEqual({ action: 'download' })
  })
  it('treats anything else as a path', () => {
    expect(parseSourceAnswer(' D:/katago/katago.exe ', 'C:/k/katago.exe')).toEqual({ action: 'typed', path: 'D:/katago/katago.exe' })
  })
})

describe('setupRecord', () => {
  it('records only the kind: a manual setup never inherits an installer lockId', () => {
    expect(setupRecord('gpu')).toEqual({ kind: 'gpu' })
  })
})
