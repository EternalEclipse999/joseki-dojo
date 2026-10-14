import { describe, expect, it } from 'vitest'
import { translator, type InstallFile } from '@joseki-dojo/shared'
import { canStartInstall, installFinishedAtOnce, downloadSizeText, fileProgressText, INSTALL_STEP_TEXT, isInstalling } from './install-format'

const t = translator('ru')

const file = (over: Partial<InstallFile>): InstallFile => ({ name: 'net.bin.gz', label: { key: 'install.file.mainNet' }, received: 0, total: 0, done: false, ...over })

describe('install screen texts', () => {
  it('warns that the GPU step is slow and says nothing while idle', () => {
    const key = INSTALL_STEP_TEXT['benchmarking-gpu']
    expect(key && t(key)).toBe('Настраиваю видеокарту — это может занять несколько минут')
    expect(INSTALL_STEP_TEXT.idle).toBeNull()
  })

  it('tells running steps from finished ones', () => {
    expect(isInstalling('downloading')).toBe(true)
    expect(isInstalling('benchmarking-gpu')).toBe(true)
    expect(isInstalling('idle')).toBe(false)
    expect(isInstalling('done')).toBe(false)
    expect(isInstalling('failed')).toBe(false)
  })

  it('shows file progress in megabytes', () => {
    expect(fileProgressText(file({}), t, 'ru')).toBe('ожидает')
    expect(fileProgressText(file({ received: 12_897_485, total: 97_898_094 }), t, 'ru')).toBe('12,3 из 93,4 МБ')
    expect(fileProgressText(file({ received: 3_145_728 }), t, 'ru')).toBe('3,0 МБ')
    expect(fileProgressText(file({ received: 10, total: 10, done: true }), t, 'ru')).toBe('готово')
  })

  it('writes the megabytes in the reader’s language', () => {
    expect(fileProgressText(file({ received: 12_897_485, total: 97_898_094 }), translator('en'), 'en')).toBe('12.3 of 93.4 MB')
    expect(fileProgressText(file({ received: 3_145_728 }), translator('ja'), 'ja')).toBe('3.0MB')
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
    expect(downloadSizeText(false, t)).toBe('около 210 МБ')
    expect(downloadSizeText(true, t)).toBe('около 280 МБ')
    expect(downloadSizeText(false, translator('en'))).toBe('about 210 MB')
  })
})

describe('installFinishedAtOnce', () => {
  it('leaves the screen at once on a plain "done" and stays on it when there is a note to read', () => {
    expect(installFinishedAtOnce({ step: 'done', note: null })).toBe(true)
    expect(installFinishedAtOnce({ step: 'done', note: { key: 'install.note.cpuFallback' } })).toBe(false)
    expect(installFinishedAtOnce({ step: 'failed', note: null })).toBe(false)
  })
})
