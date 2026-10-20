import type { AboutInfo } from '@joseki-dojo/shared'
import type { FastifyInstance } from 'fastify'
import type { SettingsService } from '../settings/service'

/** Spec (about) 3.2: the engine block of the «О программе» window. */
export function registerAboutRoutes(app: FastifyInstance, settings: SettingsService): void {
  app.get('/api/about', async (): Promise<AboutInfo> => settings.about())
}
