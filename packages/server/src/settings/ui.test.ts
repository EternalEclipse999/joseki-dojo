import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../test/helpers'
import { loadConfig } from '../config'
import { UiService, UiSettingsError } from './ui'

describe('UiService', () => {
  it('follows the system theme by default', () => {
    const file = join(tempDir(), 'config.json')
    expect(new UiService(loadConfig(file), file).view()).toEqual({ theme: 'system' })
  })

  it('saves the theme into the config file, keeping its other fields', async () => {
    const file = join(tempDir(), 'config.json')
    writeFileSync(file, JSON.stringify({ analysis: { reviewVisits: 300 }, ui: { theme: 'light' } }))
    const config = loadConfig(file)
    expect(config.ui.theme).toBe('light')
    const ui = new UiService(config, file)
    expect(await ui.setTheme('dark')).toEqual({ theme: 'dark' })
    expect(config.ui.theme).toBe('dark')
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { analysis: unknown; ui: unknown }
    expect(saved).toEqual({ analysis: { reviewVisits: 300 }, ui: { theme: 'dark' } })
    expect(loadConfig(file).ui.theme).toBe('dark')
  })

  it('refuses an unknown theme and leaves the file alone', async () => {
    const file = join(tempDir(), 'config.json')
    const ui = new UiService(loadConfig(file), file)
    await expect(ui.setTheme('neon')).rejects.toBeInstanceOf(UiSettingsError)
    await expect(ui.setTheme(undefined)).rejects.toBeInstanceOf(UiSettingsError)
    expect(ui.view()).toEqual({ theme: 'system' })
  })

  it('rejects an unknown theme in the config file', () => {
    const file = join(tempDir(), 'config.json')
    writeFileSync(file, JSON.stringify({ ui: { theme: 'neon' } }))
    expect(() => loadConfig(file)).toThrow(/ui\.theme/)
  })
})
