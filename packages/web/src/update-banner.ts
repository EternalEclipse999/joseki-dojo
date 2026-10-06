import type { AppUpdateState } from '@joseki-dojo/shared'

export interface UpdateBannerView {
  text: string
  button: { label: string; action: 'download' | 'retry' } | null
  error: boolean
}

/** Spec 6: the app update bar for each updater state; null hides it. */
export function updateBannerView(state: AppUpdateState): UpdateBannerView | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'available':
      return { text: `Доступна версия ${state.version}`, button: { label: 'Обновить', action: 'download' }, error: false }
    case 'downloading':
      return { text: `Скачиваю версию ${state.version}: ${state.percent}%`, button: null, error: false }
    case 'installing':
      return { text: `Устанавливаю версию ${state.version}, приложение перезапустится…`, button: null, error: false }
    case 'error':
      return { text: state.message, button: { label: 'Повторить', action: 'retry' }, error: true }
  }
}
