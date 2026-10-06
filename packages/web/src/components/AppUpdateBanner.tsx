import { useEffect, useState } from 'preact/hooks'
import type { AppUpdateState } from '@joseki-dojo/shared'
import { updateBannerView } from '../update-banner'

/** Spec 6: the desktop app's update bar. A browser has no `window.dojoDesktop`, so nothing is shown there. */
export function AppUpdateBanner() {
  const desktop = window.dojoDesktop
  const [state, setState] = useState<AppUpdateState>({ status: 'idle' })

  useEffect(() => {
    if (!desktop) return
    let live = true
    let changed = false
    const off = desktop.onUpdateState((s) => {
      changed = true
      setState(s)
    })
    desktop
      .getUpdateState()
      .then((s) => {
        if (live && !changed) setState(s)
      })
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [desktop])

  const view = desktop ? updateBannerView(state) : null
  if (!desktop || !view) return null
  const act = (): void => {
    void (view.button?.action === 'retry' ? desktop.retryUpdate() : desktop.downloadUpdate())
  }
  return (
    <div class={view.error ? 'bar error' : 'bar'} role="status">
      <span>{view.text}</span>
      {view.button && (
        <button class="primary" onClick={act}>
          {view.button.label}
        </button>
      )}
    </div>
  )
}
