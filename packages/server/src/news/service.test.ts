import { describe, expect, it } from 'vitest'
import { openDb, type Db } from '../store/db'
import { NewsError, NewsService } from './service'

const A = [{ id: 'a', wave: 1 }]
const AB = [{ id: 'a', wave: 1 }, { id: 'b', wave: 2 }]

const withTraining = (db: Db): Db => {
  db.prepare("INSERT INTO sessions (id, created_at, mode, environment, user_color, bot_rank, corner, status) VALUES ('s1', '2026-10-01T00:00:00.000Z', 'free', 'empty', 'B', '7k', 'TR', 'finished')").run()
  return db
}

describe('NewsService', () => {
  it('a fresh install: nothing is new', () => {
    expect(new NewsService(openDb(':memory:'), A).view()).toEqual({ unseen: [], callout: null })
  })

  it('an update (a training exists): every listed novelty is new and has its callout', () => {
    expect(new NewsService(withTraining(openDb(':memory:')), A).view()).toEqual({ unseen: ['a'], callout: 'a' })
  })

  it('an update (only a card exists) counts too', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO cards (id, kind, card_key, data_json, fsrs_json, due, created_at) VALUES ('c1', 'position', 'k', '{}', '{}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')").run()
    expect(new NewsService(db, A).view()).toEqual({ unseen: ['a'], callout: 'a' })
  })

  it('the state survives a restart; dismiss keeps the mark, seen drops both', () => {
    const db = withTraining(openDb(':memory:'))
    expect(new NewsService(db, A).dismiss('a')).toEqual({ unseen: ['a'], callout: null })
    const again = new NewsService(db, A)
    expect(again.view()).toEqual({ unseen: ['a'], callout: null })
    expect(again.seen('a')).toEqual({ unseen: [], callout: null })
    expect(new NewsService(db, A).view()).toEqual({ unseen: [], callout: null })
  })

  it('the next wave is new for a player who has seen the first, and for one who installed at the first', () => {
    const updated = withTraining(openDb(':memory:'))
    new NewsService(updated, A).seen('a')
    expect(new NewsService(updated, AB).view()).toEqual({ unseen: ['b'], callout: 'b' })
    const fresh = openDb(':memory:')
    new NewsService(fresh, A)
    withTraining(fresh)
    expect(new NewsService(fresh, AB).view()).toEqual({ unseen: ['b'], callout: 'b' })
  })

  it('several novelties: callouts in wave order; seen is harmless when repeated', () => {
    const news = new NewsService(withTraining(openDb(':memory:')), AB)
    expect(news.view()).toEqual({ unseen: ['a', 'b'], callout: 'a' })
    expect(news.dismiss('a')).toEqual({ unseen: ['a', 'b'], callout: 'b' })
    expect(news.seen('b')).toEqual({ unseen: ['a'], callout: null })
    expect(news.seen('b')).toEqual({ unseen: ['a'], callout: null })
  })

  it('a novelty no longer listed is dropped from the stored state', () => {
    const db = withTraining(openDb(':memory:'))
    new NewsService(db, AB)
    expect(new NewsService(db, A).view()).toEqual({ unseen: ['a'], callout: 'a' })
  })

  it('a damaged record counts as none', () => {
    const db = withTraining(openDb(':memory:'))
    db.prepare("INSERT INTO app_state (key, value_json) VALUES ('news', 'not json')").run()
    expect(new NewsService(db, A).view()).toEqual({ unseen: ['a'], callout: 'a' })
  })

  it('an unknown id is an error', () => {
    const news = new NewsService(openDb(':memory:'), A)
    expect(() => news.seen('zzz')).toThrow(NewsError)
    expect(() => news.dismiss('zzz')).toThrow(NewsError)
  })
})
