import type { DojoDesktopApi } from '@joseki-dojo/shared'

declare global {
  interface Window {
    /** Set by the desktop app's preload script; absent in a browser. */
    dojoDesktop?: DojoDesktopApi
  }
}

export {}
