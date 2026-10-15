import type { LocalizedText } from '@joseki-dojo/shared'
import { errorText } from '../error-text'
import { useI18n } from '../i18n'
import { Bar } from './Bar'

export function ErrorBanner({ error, onRetry }: { error: LocalizedText; onRetry?: () => void }) {
  const { language, t } = useI18n()
  return (
    <Bar tone="error" action={onRetry ? { label: t('common.retry'), onClick: onRetry } : undefined}>
      {errorText(error, language)}
    </Bar>
  )
}
