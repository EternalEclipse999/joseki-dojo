import type { AboutInfo } from '@joseki-dojo/shared'
import { LoaderCircle, X } from 'lucide-preact'
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { APP_VERSION, CREDITS, creditText, engineLines, PROJECT_LINKS } from '../about'
import { fetchAbout } from '../api'
import { useT } from '../i18n'
import { Logo } from './Logo'

type Engine = { kind: 'loading' } | { kind: 'ready'; info: AboutInfo } | { kind: 'failed' }

/**
 * Spec (about) 2.2: the «О программе» window over the current screen, open while it is mounted. Esc, the cross and a
 * click on the backdrop (it lands on the dialog itself: the dialog has no padding, its content fills it) all close the
 * dialog first and report through its `close` event: while it is still modal the page behind is inert, and the header
 * could not take the focus back. Keys pressed in it stop here, so that the screen below (the review's ← →) does not react.
 */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDialogElement>(null)
  const [engine, setEngine] = useState<Engine>({ kind: 'loading' })
  const close = (): void => ref.current?.close()

  // Removing an open modal dialog from the page takes it out of the top layer: no cleanup needed.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  // Spec (about) 3.3: asked on every opening; an answer after the window closed is dropped.
  useEffect(() => {
    let cancelled = false
    fetchAbout()
      .then((info) => !cancelled && setEngine({ kind: 'ready', info }))
      .catch((err: unknown) => {
        console.warn('about', err)
        if (!cancelled) setEngine({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <dialog
      ref={ref}
      class="about"
      aria-label={t('about.title')}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div class="about-body">
        <div class="about-head">
          <Logo />
          <div>
            <h2>Joseki Dojo</h2>
            <p>{t('about.version', { version: APP_VERSION })}</p>
          </div>
          <button class="icon ghost about-close" aria-label={t('about.close')} title={t('about.close')} onClick={close}>
            <X aria-hidden="true" />
          </button>
        </div>
        <p>{t('about.description')}</p>

        <section>
          <h3>{t('about.engine.title')}</h3>
          {engine.kind === 'loading' && (
            <p class="status-line muted">
              <LoaderCircle class="spin" aria-hidden="true" />
              {t('app.loading')}
            </p>
          )}
          {engine.kind === 'failed' && <p class="muted">{t('about.engine.failed')}</p>}
          {engine.kind === 'ready' && <EngineBlock info={engine.info} />}
        </section>

        <section>
          <h3>{t('about.links.title')}</h3>
          <ul>
            {PROJECT_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} target="_blank" rel="noreferrer">
                  {t(l.key)}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>{t('about.license.title')}</h3>
          <p>{t('about.license.text')}</p>
          <p class="muted">{t('about.credits.title')}</p>
          <ul>
            {CREDITS.map((c) => (
              <li key={c.href}>
                <a href={c.href} target="_blank" rel="noreferrer">
                  {creditText(c, t)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </dialog>
  )
}

function EngineBlock({ info }: { info: AboutInfo }) {
  const t = useT()
  const lines = engineLines(info.katago, t)
  return (
    <>
      <p>{lines.versions}</p>
      <p>{lines.setup}</p>
      {lines.networks.length > 0 && (
        <p>
          {t('about.engine.networks')}{' '}
          {lines.networks.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && t('common.listSeparator')}
              <code>{n}</code>
            </Fragment>
          ))}
        </p>
      )}
    </>
  )
}
