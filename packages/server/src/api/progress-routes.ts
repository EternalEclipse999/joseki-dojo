import type { FastifyInstance } from 'fastify'
import type { GraphProgressService } from '../progress/service'

/** Spec (progress part 2) 4: the progress of the start list for a colour at the player's level. */
export function registerProgressRoutes(app: FastifyInstance, progress: GraphProgressService): void {
  app.get<{ Querystring: { color?: string } }>('/api/progress', async (req, reply) => {
    const { color } = req.query
    if (color !== 'B' && color !== 'W') return reply.code(400).send({ error: 'bad_color' })
    return progress.progress(color)
  })
}
