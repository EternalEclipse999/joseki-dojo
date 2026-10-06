import { describe, expect, it } from 'vitest'
import { defaultKind, parseCpuAnswer } from './build-kind'

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
