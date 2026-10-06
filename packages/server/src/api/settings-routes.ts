import type { SettingsUpdate } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { SettingsService } from '../settings/service'

export function registerSettingsRoutes(app: FastifyInstance, settings: SettingsService): void {
  app.get('/api/settings', async () => settings.view())

  app.put<{ Body: SettingsUpdate }>('/api/settings', async (req, reply) => {
    const r = await settings.apply(req.body)
    return r.ok ? r : reply.code(400).send(r)
  })
}
