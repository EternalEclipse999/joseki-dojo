import type { FastifyInstance } from 'fastify'
import type { InstallerService } from '../install/installer'

export function registerInstallRoutes(app: FastifyInstance, installer: InstallerService): void {
  app.get('/api/install', async () => installer.status())

  // Spec 5.3: starts the installer; while it runs, a repeated request only returns the current state.
  app.post('/api/install', async () => installer.start())
}
