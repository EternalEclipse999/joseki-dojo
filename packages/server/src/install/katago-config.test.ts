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

  it('splits CPU cores between the analysis threads and uses 8 per thread on GPU', () => {
    expect(searchThreadsFor('cpu', 24)).toBe(12)
    expect(searchThreadsFor('cpu', 1)).toBe(1)
    expect(searchThreadsFor('gpu', 24)).toBe(8)
  })
})
