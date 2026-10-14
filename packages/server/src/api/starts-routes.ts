import type { StartsInfo } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { StartBook } from '../starts/book'

export function registerStartsRoutes(app: FastifyInstance, starts: StartBook): void {
  app.get('/api/starts', async (): Promise<StartsInfo> => ({ count: starts.count, list: starts.list() }))
}
