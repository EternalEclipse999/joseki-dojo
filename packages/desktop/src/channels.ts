/** IPC channels between the preload script (window.dojoDesktop) and the main process. */
export const CHANNELS = {
  /** main → window: the update state changed. */
  state: 'dojo:update-state',
  /** window → main: the current update state. */
  get: 'dojo:update-get',
  /** window → main: «Обновить». */
  download: 'dojo:update-download',
  /** window → main: «Повторить». */
  retry: 'dojo:update-retry',
  /** window → main: the colour theme chosen in Settings. */
  theme: 'dojo:theme-set',
} as const
