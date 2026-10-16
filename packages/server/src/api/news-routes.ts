import type { NewsView } from '@joseki-dojo/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { NewsError, type NewsService } from '../news/service'

/** Spec (whats-new) 3.3. */
export function registerNewsRoutes(app: FastifyInstance, news: NewsService): void {
  const act = (reply: FastifyReply, fn: () => NewsView): NewsView | FastifyReply => {
    try {
      return fn()
    } catch (err) {
      if (err instanceof NewsError) return reply.code(404).send({ error: err.code })
      throw err
    }
  }
  app.get('/api/news', async () => news.view())
  app.post<{ Params: { id: string } }>('/api/news/:id/seen', async (req, reply) => act(reply, () => news.seen(req.params.id)))
  app.post<{ Params: { id: string } }>('/api/news/:id/dismiss', async (req, reply) => act(reply, () => news.dismiss(req.params.id)))
}
