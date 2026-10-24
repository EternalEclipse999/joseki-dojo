import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHECKPOINT_FILE, CheckpointWriter, differsMessage, readCheckpoint, removeCheckpoint, runDifferences, type RunHeader, type SavedPosition } from './checkpoint'

const HEADER: RunHeader = {
  version: 1,
  options: { positions: 3, visits: 10, seed: 1, coverage: 0.98 },
  ids: ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'],
  levels: ['20k', 'pro'],
  code: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  katago: 'KataGo 1.18.1; networks: main.bin.gz, human.bin.gz',
}
const position = (i: number): SavedPosition => ({ i, evaluated: 2, seconds: 1.5, samples: [[[0, 0.7], [3, 0.3]], [[0, 1]]] })
const root = (): string => mkdtempSync(join(tmpdir(), 'joseki-checkpoint-'))
const file = (r: string): string => join(r, CHECKPOINT_FILE)
const write = (r: string, text: string): void => {
  mkdirSync(dirname(file(r)), { recursive: true })
  writeFileSync(file(r), text)
}
const line = (x: unknown): string => `${JSON.stringify(x)}\n`

describe('the save of a thresholds run', () => {
  it('writes the description first, then one line per position, and reads them back', () => {
    const r = root()
    const w = CheckpointWriter.start(r, HEADER)
    w.add(position(0))
    w.add(position(1))
    w.close()
    expect(readFileSync(file(r), 'utf8')).toBe(line(HEADER) + line(position(0)) + line(position(1)))
    expect(readCheckpoint(r)).toEqual({ header: HEADER, positions: [position(0), position(1)], dropped: 0 })
  })

  it('appends to a save it continues and replaces the save when a run starts from the beginning', () => {
    const r = root()
    const w = CheckpointWriter.start(r, HEADER)
    w.add(position(0))
    w.close()
    const more = CheckpointWriter.append(r)
    more.add(position(1))
    more.close()
    expect(readCheckpoint(r)?.positions).toEqual([position(0), position(1)])
    CheckpointWriter.start(r, { ...HEADER, katago: 'other' }).close()
    expect(readCheckpoint(r)).toEqual({ header: { ...HEADER, katago: 'other' }, positions: [], dropped: 0 })
  })

  it('has no save without the file, in an empty file or without a whole first line', () => {
    const r = root()
    expect(readCheckpoint(r)).toBeNull()
    write(r, '')
    expect(readCheckpoint(r)).toBeNull()
    write(r, line(HEADER).slice(0, 20))
    expect(readCheckpoint(r)).toBeNull()
  })

  it('drops a torn last line silently and cuts it off the file', () => {
    const r = root()
    const whole = line(HEADER) + line(position(0))
    write(r, whole + line(position(1)).slice(0, 15))
    expect(readCheckpoint(r)).toEqual({ header: HEADER, positions: [position(0)], dropped: 0 })
    expect(readFileSync(file(r), 'utf8')).toBe(whole)
  })

  it('keeps the sound beginning and cuts the rest off the file', () => {
    const shortIds = { ...HEADER, ids: ['aaaaaaaa'] }
    const cases: { name: string; text: string; positions: SavedPosition[]; dropped: number; kept: string }[] = [
      { name: 'not JSON', text: line(HEADER) + 'nonsense\n' + line(position(1)), positions: [], dropped: 2, kept: line(HEADER) },
      { name: 'the index out of order', text: line(HEADER) + line(position(0)) + line(position(2)), positions: [position(0)], dropped: 1, kept: line(HEADER) + line(position(0)) },
      {
        name: 'another number of columns',
        text: line(HEADER) + line({ ...position(0), samples: [[[0, 1]]] }),
        positions: [],
        dropped: 1,
        kept: line(HEADER),
      },
      { name: 'beyond the sampled', text: line(shortIds) + line(position(0)) + line(position(1)), positions: [position(0)], dropped: 1, kept: line(shortIds) + line(position(0)) },
      {
        name: 'a damaged line before a torn tail',
        text: line(HEADER) + line(position(0)) + 'nonsense\n' + line(position(1)).slice(0, 15),
        positions: [position(0)],
        dropped: 1,
        kept: line(HEADER) + line(position(0)),
      },
    ]
    for (const c of cases) {
      const r = root()
      write(r, c.text)
      const read = readCheckpoint(r)
      expect(read?.positions, c.name).toEqual(c.positions)
      expect(read?.dropped, c.name).toBe(c.dropped)
      expect(readFileSync(file(r), 'utf8'), c.name).toBe(c.kept)
    }
  })

  it('refuses a first line that is not a run description', () => {
    const r = root()
    write(r, line({ version: 2 }) + line(position(0)))
    expect(() => readCheckpoint(r)).toThrow('(the first line is not a run description)')
    write(r, line({ ...HEADER, code: 7 }) + line(position(0)))
    expect(() => readCheckpoint(r)).toThrow('(the first line is not a run description)')
  })

  it('continues a cut save: what is appended after the cut reads back whole', () => {
    const r = root()
    write(r, line(HEADER) + line(position(0)) + 'nonsense\n')
    expect(readCheckpoint(r)?.dropped).toBe(1)
    const w = CheckpointWriter.append(r)
    w.add(position(1))
    w.close()
    expect(readCheckpoint(r)).toEqual({ header: HEADER, positions: [position(0), position(1)], dropped: 0 })
  })

  it('names what differs from the saved run', () => {
    const identity = { options: HEADER.options, ids: HEADER.ids, levels: HEADER.levels, code: HEADER.code }
    expect(runDifferences(HEADER, identity)).toEqual([])
    expect(runDifferences(HEADER, { ...identity, options: { ...HEADER.options, visits: 500 } })).toEqual(['visits 10 → 500'])
    expect(runDifferences(HEADER, { ...identity, ids: ['aaaaaaaa'], levels: ['20k'] })).toEqual(['the sampled positions differ', 'the levels differ'])
    expect(runDifferences(HEADER, { ...identity, code: '5d6e7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6' })).toEqual(['the calibration code differs (1a2b3c4 → 5d6e7f8)'])
    expect(runDifferences(HEADER, { ...identity, code: '' })).toEqual(['the calibration code differs (1a2b3c4 → none)'])
    expect(differsMessage(['visits 10 → 500'])).toBe(
      'The saved run in .gpu-runs/thresholds.jsonl differs: visits 10 → 500. Run with the same options to continue, or add --restart to start over.',
    )
  })

  it('refuses to save a number that is not finite', () => {
    const r = root()
    const w = CheckpointWriter.start(r, HEADER)
    expect(() => w.add({ ...position(0), seconds: Number.NaN })).toThrow('Position 0 has a number that is not finite: it cannot be saved')
    expect(() => w.add({ ...position(0), samples: [[[0, Infinity]], [[0, 1]]] })).toThrow('Position 0 has a number that is not finite: it cannot be saved')
    w.close()
    expect(readFileSync(file(r), 'utf8')).toBe(line(HEADER))
  })

  it('removes the save, and does nothing without one', () => {
    const r = root()
    CheckpointWriter.start(r, HEADER).close()
    removeCheckpoint(r)
    expect(existsSync(file(r))).toBe(false)
    removeCheckpoint(r)
  })
})
