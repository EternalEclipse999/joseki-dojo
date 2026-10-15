import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: 'languages.spec.ts' },
    // It switches the language the 5180 server saves, so it waits until the other specs, which read Russian, are done.
    { name: 'languages', use: { browserName: 'chromium' }, testMatch: 'languages.spec.ts', dependencies: ['chromium'] },
  ],
  // Playwright starts these one after another: the first builds the web UI that the second serves too.
  webServer: [
    {
      command: `node -e "require('fs').rmSync('e2e/.data',{recursive:true,force:true})" && npx tsx e2e/make-traps.ts && npx tsx e2e/make-starts.ts && npm run build && npx tsx packages/server/src/main.ts`,
      url: 'http://127.0.0.1:5180/api/health',
      env: { JOSEKI_CONFIG: 'e2e/config.e2e.json', JOSEKI_TRAPS: 'e2e/traps.test.jdb', JOSEKI_STARTS: 'e2e/starts.test.jdb', JOSEKI_STARTS_LIST: 'e2e/starts-list.test.json', JOSEKI_STARTS_NAMES: 'e2e/starts-i18n.test.json' },
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
