import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configLanguage, forgetInstallerLanguage, readInstallerLanguage } from './installer-language'

const made: string[] = []
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'joseki-lang-'))
  made.push(d)
  return d
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('installer language', () => {
  it('reads the LANGID the installer wrote, a LANGID it does not know as English', () => {
    const d = dir()
    expect(readInstallerLanguage(d)).toBeNull()
    writeFileSync(join(d, 'installer-language'), '1042\r\n')
    expect(readInstallerLanguage(d)).toBe('ko')
    writeFileSync(join(d, 'installer-language'), '9999')
    expect(readInstallerLanguage(d)).toBe('en')
  })

  it('treats an empty or non-numeric file as no choice, so the first-start screen asks', () => {
    const d = dir()
    for (const content of ['', '\r\n', 'abc', '10x42', '-1']) {
      writeFileSync(join(d, 'installer-language'), content)
      expect(readInstallerLanguage(d), JSON.stringify(content)).toBeNull()
    }
  })

  it('forgets the file; a missing file is not an error', () => {
    const d = dir()
    const lines: string[] = []
    forgetInstallerLanguage(d, (line) => lines.push(line))
    writeFileSync(join(d, 'installer-language'), '1042')
    forgetInstallerLanguage(d, (line) => lines.push(line))
    expect(existsSync(join(d, 'installer-language'))).toBe(false)
    expect(lines).toEqual([])
  })

  it('does not throw when the file cannot be removed, it only reports it', () => {
    const d = dir()
    // rmSync without `recursive` refuses a non-empty directory: the same kind of failure as a locked file.
    mkdirSync(join(d, 'installer-language'))
    writeFileSync(join(d, 'installer-language', 'inner'), 'x')
    const lines: string[] = []
    expect(() => forgetInstallerLanguage(d, (line) => lines.push(line))).not.toThrow()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Could not remove the installer language file')
    expect(() => forgetInstallerLanguage(d)).not.toThrow()
  })

  it('takes the error box language from the config, English otherwise', () => {
    const d = dir()
    const config = join(d, 'config.json')
    expect(configLanguage(config)).toBe('en')
    writeFileSync(config, JSON.stringify({ ui: { language: 'ja' } }))
    expect(configLanguage(config)).toBe('ja')
    writeFileSync(config, '{ broken')
    expect(configLanguage(config)).toBe('en')
    writeFileSync(config, '{}')
    expect(configLanguage(config)).toBe('en')
    writeFileSync(config, JSON.stringify({ ui: { language: 'xx' } }))
    expect(configLanguage(config)).toBe('en')
  })
})
