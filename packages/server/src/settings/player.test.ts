import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir, testConfig } from '../../test/helpers'
import { PlayerService, PlayerSettingsError } from './player'

describe('PlayerService', () => {
  it('saves the level into the config file and the live config', async () => {
    const config = testConfig()
    const file = join(tempDir(), 'config.local.json')
    writeFileSync(file, JSON.stringify({ port: 5179, player: { level: '7k' } }))
    const player = new PlayerService(config, file)
    expect(player.view()).toEqual({ level: '7k' })
    expect(await player.save('3d')).toEqual({ level: '3d' })
    expect(config.player.level).toBe('3d')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ port: 5179, player: { level: '3d' } })
  })

  it('refuses an unknown level', async () => {
    const player = new PlayerService(testConfig(), join(tempDir(), 'config.local.json'))
    await expect(player.save('10p')).rejects.toBeInstanceOf(PlayerSettingsError)
  })
})
