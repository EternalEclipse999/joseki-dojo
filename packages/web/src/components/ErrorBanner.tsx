export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div class="banner" role="alert">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Повторить</button>}
    </div>
  )
}
