import { RATINGS, type CardKind, type Rating } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import { CardError, type CardService } from '../cards/service'

const STATUS: Record<CardError['code'], number> = { card_not_found: 404, review_not_found: 404, not_latest: 409, wrong_kind: 409, illegal_move: 400, engine_unavailable: 503 }

/** Spec (repetition) 7. */
export function registerCardsRoutes(app: FastifyInstance, cards: CardService): void {
  const failed = (err: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (err instanceof CardError) return reply.code(STATUS[err.code]).send({ error: err.code })
    throw err
  }
  app.get('/api/cards/summary', async () => cards.summary())
  app.get<{ Querystring: { kind?: string } }>('/api/cards', async (req) => {
    const kind = req.query.kind === 'position' || req.query.kind === 'move' ? (req.query.kind as CardKind) : undefined
    return cards.list(kind)
  })
  app.get('/api/cards/due', async () => cards.due())
  app.get('/api/cards/starts', async () => cards.startStates())
  app.delete<{ Params: { id: string } }>('/api/cards/:id', async (req, reply) => {
    try {
      cards.remove(req.params.id)
      return reply.code(204).send()
    } catch (err) {
      return failed(err, reply)
    }
  })
  app.post<{ Params: { id: string }; Body: { vertex?: unknown } }>('/api/cards/:id/answer', async (req, reply) => {
    const v = req.body?.vertex
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n >= 0 && n < 19)) return reply.code(400).send({ error: 'bad_vertex' })
    try {
      return await cards.answer(req.params.id, [v[0], v[1]])
    } catch (err) {
      return failed(err, reply)
    }
  })
  app.put<{ Params: { id: string }; Body: { rating?: unknown } }>('/api/cards/reviews/:id', async (req, reply) => {
    const rating = req.body?.rating
    if (!RATINGS.includes(rating as Rating)) return reply.code(400).send({ error: 'bad_rating' })
    const reviewId = Number(req.params.id)
    if (!Number.isInteger(reviewId)) return reply.code(404).send({ error: 'review_not_found' })
    try {
      return cards.rate(reviewId, rating as Rating)
    } catch (err) {
      return failed(err, reply)
    }
  })
}
