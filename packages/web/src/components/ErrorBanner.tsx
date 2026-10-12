import { Bar } from './Bar'

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Bar tone="error" action={onRetry ? { label: 'Повторить', onClick: onRetry } : undefined}>
      {message}
    </Bar>
  )
}
