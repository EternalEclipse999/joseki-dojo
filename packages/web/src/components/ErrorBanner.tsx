import type { LocalizedText } from '@joseki-dojo/shared'
import { errorText } from '../error-text'
import { useI18n } from '../i18n'
import { Bar } from './Bar'

export function ErrorBanner({ error, onRetry }: { error: LocalizedText | string; onRetry?: () => void }) {
  const { language } = useI18n()
  return (
    <Bar tone="error" action={onRetry ? { label: 'Повторить', onClick: onRetry } : undefined}>
      {errorText(error, language)}
    </Bar>
  )
}
