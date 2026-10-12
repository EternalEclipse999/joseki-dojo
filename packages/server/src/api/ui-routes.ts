import type { FastifyInstance } from 'fastify'
import { UiSettingsError, type UiService } from '../settings/ui'

export function registerUiRoutes(app: FastifyInstance, ui: UiService): void {
  app.get('/api/ui', async () => ui.view())

  app.put<{ Body: { theme?: unknown } }>('/api/ui', async (req, reply) => {
    try {
      return await ui.setTheme(req.body?.theme)
    } catch (err) {
      if (err instanceof UiSettingsError) return reply.code(400).send({ error: err.message })
      throw err
    }
  })
}
