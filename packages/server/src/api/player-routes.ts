import type { PlayerSettings } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import { PlayerSettingsError, type PlayerService } from '../settings/player'

export function registerPlayerRoutes(app: FastifyInstance, player: PlayerService): void {
  app.get('/api/player', async (): Promise<PlayerSettings> => player.view())
  app.put<{ Body: { level?: unknown } }>('/api/player', async (req, reply) => {
    try {
      return await player.save(String(req.body?.level ?? ''))
    } catch (err) {
      if (err instanceof PlayerSettingsError) return reply.code(400).send({ error: err.text })
      throw err
    }
  })
}
