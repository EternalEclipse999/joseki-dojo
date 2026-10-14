import { useEffect, useState } from 'preact/hooks'
import type { AppUpdateState } from '@joseki-dojo/shared'
import { Download } from 'lucide-preact'
import { errorText } from '../error-text'
import { useI18n } from '../i18n'
import { updateBannerView } from '../update-banner'
import { Bar } from './Bar'

/** Spec 6: the desktop app's update bar. A browser has no `window.dojoDesktop`, so nothing is shown there. */
export function AppUpdateBanner() {
  const desktop = window.dojoDesktop
  const [state, setState] = useState<AppUpdateState>({ status: 'idle' })
  const { language, t } = useI18n()

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
    <Bar
      tone={view.error ? 'error' : 'info'}
      icon={view.error ? undefined : Download}
      action={view.button ? { label: t(view.button.label), onClick: act, primary: true } : undefined}
    >
      {errorText(view.text, language)}
    </Bar>
  )
}
