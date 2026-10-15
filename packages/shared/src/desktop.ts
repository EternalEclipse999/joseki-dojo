import type { LocalizedText } from './i18n'

/** Spec 6: what the desktop app's updater is doing, as shown in the update bar. */
export type AppUpdateState =
  | { status: 'idle' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'installing'; version: string }
  | { status: 'error'; text: LocalizedText }

/** Exposed by the desktop app's preload script as `window.dojoDesktop`; absent in a browser. */
export interface DojoDesktopApi {
  getUpdateState(): Promise<AppUpdateState>
  /** Calls `listener` on every change; returns the unsubscribe function. */
  onUpdateState(listener: (state: AppUpdateState) => void): () => void
  /** «Обновить»: downloads the available version, then the app restarts into it. */
  downloadUpdate(): Promise<void>
  /** «Повторить» after an error: downloads again when a version is known, otherwise checks again. */
  retryUpdate(): Promise<void>
  /** Themes the window (title bar included) to match the page. */
  setTheme(theme: import('./types').Theme): Promise<void>
}
