import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node -e "require('fs').rmSync('e2e/.data',{recursive:true,force:true})" && npm run build && npx tsx packages/server/src/main.ts`,
    url: 'http://127.0.0.1:5180/api/health',
    env: { JOSEKI_CONFIG: 'e2e/config.e2e.json' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
