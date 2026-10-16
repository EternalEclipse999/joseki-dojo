import { useT } from '../i18n'

/** Spec (whats-new) 2.1: the quiet «новое» pill on a control whose novelty the player has not opened yet. */
export function NewMark() {
  const t = useT()
  return <span class="new-mark">{t('news.badge')}</span>
}
