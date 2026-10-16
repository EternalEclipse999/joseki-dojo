import { NEWS, type NewsView } from '@joseki-dojo/shared'
import type { Db } from '../store/db'

export interface NewsItem {
  id: string
  wave: number
}

interface NewsState {
  /** The last wave taken into account. */
  wave: number
  /** The novelties to mark, in wave order. */
  unseen: string[]
  /** The novelties whose callout is not closed yet, in wave order. */
  callouts: string[]
}

export class NewsError extends Error {
  constructor(readonly code: 'news_not_found') {
    super(code)
  }
}

const KEY = 'news'

/**
 * Spec (whats-new) 3.2: which novelties are new for this player, kept in `app_state` under `news`. The first start with
 * no record is an update when the database already holds a training or a card (every listed novelty is new), a fresh
 * install otherwise (none is). Then every novelty of a later wave than the recorded one becomes new.
 */
export class NewsService {
  private state: NewsState

  constructor(
    private readonly db: Db,
    private readonly news: readonly NewsItem[] = NEWS,
  ) {
    this.state = this.start()
  }

  view(): NewsView {
    return { unseen: [...this.state.unseen], callout: this.state.callouts[0] ?? null } as NewsView
  }

  /** The player opened the novelty: no mark, no callout. */
  seen(id: string): NewsView {
    this.known(id)
    this.save({ ...this.state, unseen: this.state.unseen.filter((x) => x !== id), callouts: this.state.callouts.filter((x) => x !== id) })
    return this.view()
  }

  /** The callout was closed; the mark stays until the player opens the novelty. */
  dismiss(id: string): NewsView {
    this.known(id)
    this.save({ ...this.state, callouts: this.state.callouts.filter((x) => x !== id) })
    return this.view()
  }

  private known(id: string): void {
    if (!this.news.some((n) => n.id === id)) throw new NewsError('news_not_found')
  }

  private start(): NewsState {
    const latest = Math.max(0, ...this.news.map((n) => n.wave))
    const listed = new Set(this.news.map((n) => n.id))
    const stored = this.read()
    const base: NewsState = stored
      ? { wave: stored.wave, unseen: stored.unseen.filter((id) => listed.has(id)), callouts: stored.callouts.filter((id) => listed.has(id)) }
      : { wave: this.hasHistory() ? 0 : latest, unseen: [], callouts: [] }
    const fresh = this.news.filter((n) => n.wave > base.wave).sort((a, b) => a.wave - b.wave).map((n) => n.id)
    const add = (list: string[]): string[] => [...list, ...fresh.filter((id) => !list.includes(id))]
    const next = { wave: Math.max(base.wave, latest), unseen: add(base.unseen), callouts: add(base.callouts) }
    this.save(next)
    return next
  }

  private hasHistory(): boolean {
    const row = this.db.prepare('SELECT EXISTS (SELECT 1 FROM sessions) OR EXISTS (SELECT 1 FROM cards) AS h').get() as { h: number }
    return row.h === 1
  }

  /** The stored state; a missing or damaged record is none. */
  private read(): NewsState | null {
    const row = this.db.prepare('SELECT value_json FROM app_state WHERE key = ?').get(KEY) as { value_json: string } | undefined
    if (!row) return null
    try {
      const v = JSON.parse(row.value_json) as Partial<NewsState>
      const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string')
      if (typeof v.wave !== 'number' || !strings(v.unseen) || !strings(v.callouts)) return null
      return { wave: v.wave, unseen: v.unseen, callouts: v.callouts }
    } catch {
      return null
    }
  }

  private save(state: NewsState): void {
    this.db.prepare('INSERT INTO app_state (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(KEY, JSON.stringify(state))
    this.state = state
  }
}
