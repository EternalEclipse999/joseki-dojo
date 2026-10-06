import { describe, expect, it } from 'vitest'
import type { InstallFile } from '@joseki-dojo/shared'
import { fileProgressText, INSTALL_STEP_TEXT, isInstalling } from './install-format'

const file = (over: Partial<InstallFile>): InstallFile => ({ name: 'net.bin.gz', label: 'Основная сеть', received: 0, total: 0, done: false, ...over })

describe('install screen texts', () => {
  it('warns that the GPU step is slow', () => {
    expect(INSTALL_STEP_TEXT['benchmarking-gpu']).toBe('Настраиваю видеокарту — это может занять несколько минут')
  })

  it('tells running steps from finished ones', () => {
    expect(isInstalling('downloading')).toBe(true)
    expect(isInstalling('benchmarking-gpu')).toBe(true)
    expect(isInstalling('idle')).toBe(false)
    expect(isInstalling('done')).toBe(false)
    expect(isInstalling('failed')).toBe(false)
  })

  it('shows file progress in megabytes', () => {
    expect(fileProgressText(file({}))).toBe('ожидает')
    expect(fileProgressText(file({ received: 12_897_485, total: 97_898_094 }))).toBe('12,3 из 93,4 МБ')
    expect(fileProgressText(file({ received: 3_145_728 }))).toBe('3,0 МБ')
    expect(fileProgressText(file({ received: 10, total: 10, done: true }))).toBe('готово')
  })
})
