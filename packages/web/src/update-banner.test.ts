import { describe, expect, it } from 'vitest'
import { localize, type LocalizedText } from '@joseki-dojo/shared'
import { updateBannerView } from './update-banner'

const ru = (text: LocalizedText | undefined): string | undefined => text && localize('ru', text)

describe('updateBannerView', () => {
  it('is hidden while there is nothing to say', () => {
    expect(updateBannerView({ status: 'idle' })).toBeNull()
  })

  it('offers the new version with one button', () => {
    const view = updateBannerView({ status: 'available', version: '0.2.0' })
    expect(view).toMatchObject({ button: { label: 'update.action', action: 'download' }, error: false })
    expect(ru(view?.text)).toBe('Доступна версия 0.2.0')
    expect(view && localize('en', view.text)).toBe('Version 0.2.0 is available')
  })

  it('shows the download percentage and then the restart', () => {
    const downloading = updateBannerView({ status: 'downloading', version: '0.2.0', percent: 42 })
    expect(downloading?.button).toBeNull()
    expect(ru(downloading?.text)).toBe('Скачиваю версию 0.2.0: 42%')
    const installing = updateBannerView({ status: 'installing', version: '0.2.0' })
    expect(installing?.button).toBeNull()
    expect(ru(installing?.text)).toBe('Устанавливаю версию 0.2.0, приложение перезапустится…')
  })

  it('shows an error with a retry button', () => {
    const text: LocalizedText = { key: 'update.error.download', params: { detail: 'offline' } }
    expect(updateBannerView({ status: 'error', text })).toEqual({
      text,
      button: { label: 'common.retry', action: 'retry' },
      error: true,
    })
  })
})
