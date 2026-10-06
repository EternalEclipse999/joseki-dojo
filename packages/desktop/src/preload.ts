// Preload script (sandboxed): gives the page `window.dojoDesktop` and nothing else (spec 6).
import type { AppUpdateState, DojoDesktopApi } from '@joseki-dojo/shared'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS } from './channels'

const api: DojoDesktopApi = {
  getUpdateState: () => ipcRenderer.invoke(CHANNELS.get) as Promise<AppUpdateState>,
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: AppUpdateState): void => listener(state)
    ipcRenderer.on(CHANNELS.state, handler)
    return () => {
      ipcRenderer.removeListener(CHANNELS.state, handler)
    }
  },
  downloadUpdate: () => ipcRenderer.invoke(CHANNELS.download) as Promise<void>,
  retryUpdate: () => ipcRenderer.invoke(CHANNELS.retry) as Promise<void>,
}

contextBridge.exposeInMainWorld('dojoDesktop', api)
