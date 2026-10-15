import type { ClientMessage, HealthResponse, InstallStatus, Language, LocalizedText, MessageKey, ReviewData, ServerMessage, SettingsResponse, SettingsUpdate, SettingsView, StartsInfo, Theme, TrapsInfo, UiSettings } from '@joseki-dojo/shared'

/** Spec (languages) 6: a failed request, kept as a key so that it is shown in the reader's language. */
export class ApiError extends Error {
  constructor(readonly text: LocalizedText) {
    super(text.key)
  }
}

// The status is a code, not a quantity: a string, so that it is not grouped like a number.
const failed = (key: MessageKey, res: Response): ApiError => new ApiError({ key, params: { status: String(res.status) } })

/**
 * `fetch` whose rejection (the request never reached the app server: `fetch` throws a `TypeError` then) becomes a lost-connection `ApiError`. Only the
 * transport is mapped: a `TypeError` from a bug further on stays an internal error.
 */
async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new ApiError({ key: 'error.network' })
  }
}

/** What to show for a caught error: a failed request's own text (the lost connection included); anything else as an internal error with its message. */
export const failureText = (e: unknown): LocalizedText =>
  e instanceof ApiError ? e.text : { key: 'error.internal', params: { detail: e instanceof Error ? e.message : String(e) } }

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await request('/api/health')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Restarts a failed engine and runs the startup checks again; resolves when they are done. */
export async function recheckHealth(): Promise<HealthResponse> {
  const res = await request('/api/health/recheck', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as HealthResponse
}

/** Null while the review is still being prepared (HTTP 409). */
export async function fetchReview(sessionId: string): Promise<ReviewData | null> {
  const res = await request(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
  if (res.status === 409) return null
  if (!res.ok) throw failed('error.api.review', res)
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

/** Interface preferences (the colour theme). */
export async function fetchUi(): Promise<UiSettings> {
  const res = await request('/api/ui')
  if (!res.ok) throw failed('error.api.ui', res)
  return (await res.json()) as UiSettings
}

export async function saveTheme(theme: Theme): Promise<UiSettings> {
  const res = await request('/api/ui', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme }) })
  if (!res.ok) throw failed('error.api.saveUi', res)
  return (await res.json()) as UiSettings
}

export async function saveLanguage(language: Language): Promise<UiSettings> {
  const res = await request('/api/ui', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language }) })
  if (!res.ok) throw failed('error.api.saveUi', res)
  return (await res.json()) as UiSettings
}

/** Spec (starts) 5.1: the size of the starts base and the named list; an empty base turns both start modes off. */
export async function fetchStarts(): Promise<StartsInfo> {
  const res = await request('/api/starts')
  if (!res.ok) throw failed('error.api.starts', res)
  return (await res.json()) as StartsInfo
}

/** Spec (traps) 5: how many traps the base holds; 0 disables the mode. */
export async function fetchTraps(): Promise<TrapsInfo> {
  const res = await request('/api/traps')
  if (!res.ok) throw failed('error.api.traps', res)
  return (await res.json()) as TrapsInfo
}

export async function fetchSettings(): Promise<SettingsView> {
  const res = await request('/api/settings')
  if (!res.ok) throw failed('error.api.settings', res)
  return (await res.json()) as SettingsView
}

/** 200 and 400 both carry a SettingsResponse; anything else is a transport error. */
export async function saveSettings(update: SettingsUpdate): Promise<SettingsResponse> {
  const res = await request('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update),
  })
  if (res.status !== 200 && res.status !== 400) throw failed('error.api.saveSettings', res)
  return (await res.json()) as SettingsResponse
}

/** Spec 5.3: the KataGo installer's state, also telling whether KataGo is installed at all. */
export async function fetchInstall(): Promise<InstallStatus> {
  const res = await request('/api/install')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as InstallStatus
}

/** Starts the KataGo installer (a running installation is left alone) and returns its state. */
export async function startInstall(): Promise<InstallStatus> {
  const res = await request('/api/install', { method: 'POST' })
  if (!res.ok) throw failed('error.api.install', res)
  return (await res.json()) as InstallStatus
}
