import { useEffect, useState } from 'preact/hooks'
import { Check, CircleAlert, Download, LoaderCircle, RotateCcw } from 'lucide-preact'
import { localize, type InstallStatus, type LocalizedText } from '@joseki-dojo/shared'
import { failureText, fetchInstall, startInstall } from '../api'
import { errorText } from '../error-text'
import { useI18n } from '../i18n'
import { canStartInstall, downloadSizeText, fileProgressText, INSTALL_STEP_TEXT, installFinishedAtOnce, isInstalling } from '../install-format'

export interface InstallScreenProps {
  /** An engine update from the banner or a re-pick: it starts at once and can be left after a failure. */
  update: boolean
  /** The player asked to pick the engine again (the title says so instead of "update"). */
  repick?: boolean
  /** The installation finished and KataGo runs. */
  onDone: () => void
  /** Leaves a failed engine update (the previous KataGo keeps working). */
  onClose?: () => void
}

/** Spec 5: downloads and sets up KataGo with one button, polling the server once a second. */
export function InstallScreen({ update, repick = false, onDone, onClose }: InstallScreenProps) {
  const { language, t } = useI18n()
  const [status, setStatus] = useState<InstallStatus | null>(null)
  const [requestError, setRequestError] = useState<LocalizedText | null>(null)
  // A first install watches from the start (an installation may already run). An update watches only after its
  // own start request, so a 'done' left over from an earlier installation is not taken for this one.
  const [watching, setWatching] = useState(!update)

  const start = async (): Promise<void> => {
    setRequestError(null)
    try {
      setStatus(await startInstall())
      setWatching(true)
    } catch (e) {
      setRequestError(failureText(e))
    }
  }

  useEffect(() => {
    if (update) void start()
  }, [])

  useEffect(() => {
    if (!watching) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const s = await fetchInstall()
        if (cancelled) return
        setStatus(s)
        if (installFinishedAtOnce(s)) {
          onDone()
          return
        }
        if (s.step === 'done') return // a note to read: the Continue button (install.continue) leaves
      } catch {
        // transient failure: try again on the next tick
      }
      if (!cancelled) timer = setTimeout(() => void tick(), 1000)
    }
    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [watching])

  const step = status?.step ?? 'idle'
  const running = isInstalling(step)
  const failed = step === 'failed' || requestError !== null
  const canStart = canStartInstall({ update, running, failed, installed: status?.installed })

  const title = t(repick ? 'install.title.repick' : update ? 'install.title.update' : 'install.title.first')
  const stepText = INSTALL_STEP_TEXT[step]
  const showCard = running || step === 'done' || step === 'failed' || (status !== null && status.files.length > 0)

  return (
    <main>
      <div class="page install">
        <div class="page-head">
          <h1>{title}</h1>
          {!update && !running && <p>{t('install.intro', { size: downloadSizeText(/linux/i.test(navigator.userAgent), t) })}</p>}
        </div>
        {showCard && (
          <div class="card section">
            {(running || step === 'done') && (
              <p class="status-line">
                {running ? <LoaderCircle class="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                {stepText && t(stepText)}
              </p>
            )}
            {status && status.files.length > 0 && (
              <ul class="files">
                {status.files.map((f) => (
                  <li key={f.name}>
                    <div class="row">
                      <span>{localize(language, f.label)}</span>
                      <span class="meta">{fileProgressText(f, t, language)}</span>
                    </div>
                    <progress max={f.total || 1} value={f.done ? f.total || 1 : f.received} />
                  </li>
                ))}
              </ul>
            )}
            {step === 'done' && status?.note && <p class="hint">{localize(language, status.note)}</p>}
            {step === 'failed' && (
              <>
                <p class="status-line error">
                  <CircleAlert aria-hidden="true" />
                  {t('install.step.failed')}
                </p>
                <p class="hint error">{status?.error && errorText(status.error, language)}</p>
              </>
            )}
          </div>
        )}
        {requestError && <p class="hint error">{errorText(requestError, language)}</p>}
        <div class="actions">
          {canStart && (
            <button class="primary lg" onClick={() => void start()}>
              {failed ? <RotateCcw aria-hidden="true" /> : <Download aria-hidden="true" />}
              {t(failed ? 'install.tryAgain' : 'install.start')}
            </button>
          )}
          {step === 'done' && status?.note && (
            <button class="primary lg" onClick={onDone}>
              {t('install.continue')}
            </button>
          )}
          {update && failed && onClose && (
            <button class="ghost" onClick={onClose}>
              {t('common.back')}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
