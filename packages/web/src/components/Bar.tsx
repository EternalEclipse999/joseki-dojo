import type { ComponentChildren, ComponentType } from 'preact'
import { CircleAlert, Info, TriangleAlert, type LucideProps } from 'lucide-preact'

export interface BarProps {
  tone?: 'info' | 'warning' | 'error'
  icon?: ComponentType<LucideProps>
  action?: { label: string; onClick: () => void; primary?: boolean }
  children: ComponentChildren
}

const TONE_ICON = { info: Info, warning: TriangleAlert, error: CircleAlert }

/** Spec 4: one thin bar under the header for errors, updates and warnings. */
export function Bar({ tone = 'info', icon, action, children }: BarProps) {
  const Icon = icon ?? TONE_ICON[tone]
  return (
    <div class={tone === 'info' ? 'bar' : `bar ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <span class="text">{children}</span>
      {action && (
        <button class={action.primary ? 'sm primary' : 'sm'} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
