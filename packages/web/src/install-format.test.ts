import { describe, expect, it } from 'vitest'
import type { InstallFile } from '@joseki-dojo/shared'
import { canStartInstall, installFinishedAtOnce, downloadSizeText, fileProgressText, INSTALL_STEP_TEXT, isInstalling } from './install-format'

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

describe('canStartInstall', () => {
  it('offers the button on a first installation whenever KataGo is not installed, even after a "done"', () => {
    expect(canStartInstall({ update: false, running: false, failed: false, installed: false })).toBe(true)
    expect(canStartInstall({ update: false, running: false, failed: false, installed: undefined })).toBe(true)
    expect(canStartInstall({ update: false, running: true, failed: false, installed: false })).toBe(false)
    expect(canStartInstall({ update: false, running: false, failed: false, installed: true })).toBe(false)
  })

  it('an update starts by itself: the button only retries after a failure', () => {
    expect(canStartInstall({ update: true, running: false, failed: false, installed: true })).toBe(false)
    expect(canStartInstall({ update: true, running: false, failed: true, installed: true })).toBe(true)
    expect(canStartInstall({ update: true, running: true, failed: true, installed: true })).toBe(false)
  })
})

describe('downloadSizeText', () => {
  it('names the size for the player system', () => {
    expect(downloadSizeText(false)).toBe('около 210 МБ')
    expect(downloadSizeText(true)).toBe('около 280 МБ')
  })
})

describe('installFinishedAtOnce', () => {
  it('leaves the screen at once on a plain "done" and stays on it when there is a note to read', () => {
    expect(installFinishedAtOnce({ step: 'done', note: null })).toBe(true)
    expect(installFinishedAtOnce({ step: 'done', note: 'Используется процессор: видеокарта не запустилась.' })).toBe(false)
    expect(installFinishedAtOnce({ step: 'failed', note: null })).toBe(false)
  })
})
