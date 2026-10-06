import type { FastifyInstance } from 'fastify'
import type { AppServices } from '../app'

export function registerHttp(app: FastifyInstance, deps: Pick<AppServices, 'health' | 'reviews'>): void {
  app.get('/api/health', async () => deps.health.get())

  // The "check again" button: restarts a failed engine and runs the startup checks anew.
  app.post('/api/health/recheck', async () => deps.health.recover())

  app.get<{ Params: { id: string } }>('/api/sessions/:id/review', async (req, reply) => {
    const r = deps.reviews.get(req.params.id)
    if (r.status === 'not_found') return reply.code(404).send({ error: 'session_not_found' })
    if (r.status === 'not_ready') return reply.code(409).send({ error: 'not_ready' })
    return r.review
  })
}
