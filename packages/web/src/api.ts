import type {
  ClientMessage,
  HealthResponse,
  InstallStatus,
  ReviewData,
  ServerMessage,
  SettingsResponse,
  SettingsUpdate,
  SettingsView,
} from '@joseki-dojo/shared'

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Restarts a failed engine and runs the startup checks again; resolves when they are done. */
export async function recheckHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health/recheck', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Null while the review is still being prepared (HTTP 409). */
export async function fetchReview(sessionId: string): Promise<ReviewData | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
  if (res.status === 409) return null
  if (!res.ok) throw new Error(`Не удалось загрузить разбор: HTTP ${res.status}`)
  return (await res.json()) as ReviewData
}

/** WebSocket that reconnects with backoff and re-subscribes to `sessionId` after reconnecting. */
export class DojoSocket {
  sessionId: string | null = null
  private ws: WebSocket | null = null
  private retries = 0
  private readonly queue: string[] = []

  constructor(
    private readonly onMessage: (msg: ServerMessage) => void,
    private readonly onStatus: (connected: boolean) => void,
  ) {
    this.connect()
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
    else this.queue.push(data)
  }

  private connect(): void {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      this.onStatus(true)
      if (this.sessionId) ws.send(JSON.stringify({ type: 'resync', sessionId: this.sessionId }))
      for (const data of this.queue.splice(0)) ws.send(data)
    }
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage)
    ws.onclose = () => {
      this.onStatus(false)
      const delay = Math.min(5000, 250 * 2 ** this.retries++)
      setTimeout(() => this.connect(), delay)
    }
  }
}

export async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch('/api/settings')
  if (!res.ok) throw new Error(`Не удалось загрузить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsView
}

/** 200 and 400 both carry a SettingsResponse; anything else is a transport error. */
export async function saveSettings(update: SettingsUpdate): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (res.status !== 200 && res.status !== 400) throw new Error(`Не удалось сохранить настройки: HTTP ${res.status}`)
  return (await res.json()) as SettingsResponse
}

/** Spec 5.3: the KataGo installer's state, also telling whether KataGo is installed at all. */
export async function fetchInstall(): Promise<InstallStatus> {
  const res = await fetch('/api/install')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as InstallStatus
}

/** Starts the KataGo installer (a running installation is left alone) and returns its state. */
export async function startInstall(): Promise<InstallStatus> {
  const res = await fetch('/api/install', { method: 'POST' })
  if (!res.ok) throw new Error(`Не удалось запустить установку: HTTP ${res.status}`)
  return (await res.json()) as InstallStatus
}
