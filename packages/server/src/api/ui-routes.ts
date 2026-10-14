import type { FastifyInstance } from 'fastify'
import { isLanguage } from '@joseki-dojo/shared'
import { UiSettingsError, type UiService } from '../settings/ui'

export function registerUiRoutes(app: FastifyInstance, ui: UiService): void {
  app.get('/api/ui', async () => ui.view())

  /** `{ theme }` and/or `{ language }`; an invalid value changes nothing; an empty body is an unknown theme, as before. */
  app.put<{ Body: { theme?: unknown; language?: unknown } }>('/api/ui', async (req, reply) => {
    const { theme, language } = req.body ?? {}
    try {
      if (language !== undefined && !isLanguage(language)) throw new UiSettingsError({ key: 'error.ui.language' })
      if (theme !== undefined || language === undefined) await ui.setTheme(theme)
      if (language !== undefined) await ui.setLanguage(language)
      return ui.view()
    } catch (err) {
      if (err instanceof UiSettingsError) return reply.code(400).send({ error: err.text })
      throw err
    }
  })
}
