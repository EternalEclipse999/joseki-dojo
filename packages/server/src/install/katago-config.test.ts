import { describe, expect, it } from 'vitest'
import { analysisConfigText, searchThreadsFor } from './katago-config'

describe('analysis config', () => {
  it('reports from Black’s view and uses forward slashes', () => {
    const text = analysisConfigText({ logDir: 'C:\\dojo\\data\\katago-logs', searchThreadsPerAnalysisThread: 6 })
    expect(text).toContain('reportAnalysisWinratesAs = BLACK')
    expect(text).toContain('logDir = C:/dojo/data/katago-logs')
    expect(text).toContain('numAnalysisThreads = 2')
    expect(text).toContain('numSearchThreadsPerAnalysisThread = 6')
  })

  it('always writes nnMaxBatchSize (the GPU backends refuse to start without it): threads x search threads, at least 8', () => {
    const batch = (n: number): string | undefined =>
      analysisConfigText({ logDir: 'x', searchThreadsPerAnalysisThread: n }).match(/^nnMaxBatchSize = (\d+)$/m)?.[1]
    expect(batch(8)).toBe('16')
    expect(batch(12)).toBe('24')
    expect(batch(2)).toBe('8')
    expect(batch(1)).toBe('8')
  })

  it('splits CPU cores between the analysis threads and uses 8 per thread on GPU', () => {
    expect(searchThreadsFor('cpu', 24)).toBe(12)
    expect(searchThreadsFor('cpu', 1)).toBe(1)
    expect(searchThreadsFor('gpu', 24)).toBe(8)
  })
})
