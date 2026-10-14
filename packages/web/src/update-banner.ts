import type { AppUpdateState, LocalizedText, MessageKey } from '@joseki-dojo/shared'

export interface UpdateBannerView {
  text: LocalizedText
  button: { label: MessageKey; action: 'download' | 'retry' } | null
  error: boolean
}

/** Spec 6: the app update bar for each updater state; null hides it. */
export function updateBannerView(state: AppUpdateState): UpdateBannerView | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'available':
      return { text: { key: 'update.available', params: { version: state.version } }, button: { label: 'update.action', action: 'download' }, error: false }
    case 'downloading':
      return { text: { key: 'update.downloading', params: { version: state.version, percent: state.percent } }, button: null, error: false }
    case 'installing':
      return { text: { key: 'update.installing', params: { version: state.version } }, button: null, error: false }
    case 'error':
      return { text: state.text, button: { label: 'common.retry', action: 'retry' }, error: true }
  }
}
