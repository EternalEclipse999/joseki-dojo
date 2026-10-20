import { readFileSync } from 'node:fs'
import { translator, type AboutInfo } from '@joseki-dojo/shared'
import { describe, expect, it } from 'vitest'
import { APP_VERSION, CREDITS, creditText, engineLines } from './about'

const t = translator('ru')
const katago = (over: Partial<AboutInfo['katago']> = {}): AboutInfo['katago'] => ({
  lockedVersion: '1.18.1',
  runningVersion: '1.18.1',
  setup: 'cpu',
  mainModel: 'kata1-b18c384nbt-s9996604416-d4316597426',
  humanModel: 'b18c384nbt-humanv0',
  ...over,
})

describe('the About window', () => {
  it('shows the root package.json version', () => {
    const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(APP_VERSION).toBe(version)
  })

  it('tells the pinned and the running KataGo', () => {
    expect(engineLines(katago(), t).versions).toBe('KataGo: проверенная версия 1.18.1, запущена 1.18.1')
    expect(engineLines(katago({ runningVersion: null }), t).versions).toBe('KataGo: проверенная версия 1.18.1, не запущена')
  })

  it('names the build by who set KataGo up, and lists the networks unless KataGo is missing', () => {
    expect(engineLines(katago(), t).setup).toBe('Сборка: процессор')
    expect(engineLines(katago({ setup: 'gpu' }), t).setup).toBe('Сборка: видеокарта')
    expect(engineLines(katago({ setup: 'manual' }), t).setup).toBe('Сборка: настроена вручную')
    expect(engineLines(katago(), t).networks).toEqual(['kata1-b18c384nbt-s9996604416-d4316597426', 'b18c384nbt-humanv0'])
    const missing = engineLines(katago({ setup: 'missing', runningVersion: null }), t)
    expect(missing.setup).toBe('KataGo не установлен')
    expect(missing.networks).toEqual([])
  })

  it('keeps the projects’ names and translates what describes a network', () => {
    const ru = CREDITS.map((c) => creditText(c, t))
    expect(ru).toEqual(expect.arrayContaining(['KataGo', 'Shudan', 'Electron', 'сети KataGo (katagotraining.org)']))
    expect(CREDITS.map((c) => creditText(c, translator('en')))).toContain('KataGo networks (katagotraining.org)')
  })
})
