import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // Playwright starts these one after another: the first builds the web UI that the second serves too.
  webServer: [
    {
      command: `node -e "require('fs').rmSync('e2e/.data',{recursive:true,force:true})" && npm run build && npx tsx packages/server/src/main.ts`,
      url: 'http://127.0.0.1:5180/api/health',
      env: { JOSEKI_CONFIG: 'e2e/config.e2e.json' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Spec 9: KataGo is missing; the installer downloads from a local fixture server and runs the fake KataGo.
      command: 'npx tsx e2e/install-server.ts',
      url: 'http://127.0.0.1:5181/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Spec 9: KataGo is installed from an older katago.lock.json: the engine-update bar and the re-pick button.
      command: 'npx tsx e2e/repick-server.ts',
      url: 'http://127.0.0.1:5182/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
