import { describe, expect, it } from 'vitest'
import { updateBannerView } from './update-banner'

describe('updateBannerView', () => {
  it('is hidden while there is nothing to say', () => {
    expect(updateBannerView({ status: 'idle' })).toBeNull()
  })

  it('offers the new version with one button', () => {
    expect(updateBannerView({ status: 'available', version: '0.2.0' })).toEqual({
      text: 'Доступна версия 0.2.0',
      button: { label: 'Обновить', action: 'download' },
      error: false,
    })
  })

  it('shows the download percentage and then the restart', () => {
    expect(updateBannerView({ status: 'downloading', version: '0.2.0', percent: 42 })).toMatchObject({ text: 'Скачиваю версию 0.2.0: 42%', button: null })
    expect(updateBannerView({ status: 'installing', version: '0.2.0' })).toMatchObject({
      text: 'Устанавливаю версию 0.2.0, приложение перезапустится…',
      button: null,
    })
  })

  it('shows an error with a retry button', () => {
    expect(updateBannerView({ status: 'error', message: 'Не удалось скачать обновление: offline' })).toEqual({
      text: 'Не удалось скачать обновление: offline',
      button: { label: 'Повторить', action: 'retry' },
      error: true,
    })
  })
})
