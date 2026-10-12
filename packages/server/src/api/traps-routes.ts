import type { TrapsInfo } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { TrapBook } from '../traps/book'

export function registerTrapsRoutes(app: FastifyInstance, traps: TrapBook): void {
  app.get('/api/traps', async (): Promise<TrapsInfo> => ({ count: traps.count, verified: traps.verified }))
}
