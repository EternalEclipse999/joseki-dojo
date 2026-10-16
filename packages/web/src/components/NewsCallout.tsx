import type { NewsId } from '@joseki-dojo/shared'
import { useT } from '../i18n'

export interface NewsCalloutProps {
  id: NewsId
  onOpen: () => void
  onDismiss: () => void
}

/**
 * Spec (whats-new) 2.2: the callout under the novelty's header button. It does not take the focus and does not block the
 * screen; Esc closes it only when the focus is inside (other screens have their own Esc).
 */
export function NewsCallout({ id, onOpen, onDismiss }: NewsCalloutProps) {
  const t = useT()
  const titleId = `news-${id}-title`
  const textId = `news-${id}-text`
  return (
    <div
      class="news-callout"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDismiss()
      }}
    >
      <b id={titleId}>{t(`news.${id}.title`)}</b>
      <p id={textId}>{t(`news.${id}.text`)}</p>
      <div class="actions">
        <button class="ghost sm" onClick={onDismiss}>
          {t('news.dismiss')}
        </button>
        <button class="primary sm" onClick={onOpen}>
          {t('news.open')}
        </button>
      </div>
    </div>
  )
}
