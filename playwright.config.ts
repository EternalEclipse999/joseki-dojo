import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5180' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: ['languages.spec.ts', 'problems.spec.ts', 'news.spec.ts', 'progress.spec.ts'] },
    // It saves other languages, so it runs against its own server (5183), not the one the other specs read Russian from.
    { name: 'languages', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5183' }, testMatch: 'languages.spec.ts' },
    // A mistake in a training needs the fake KataGo with a penalty stone, so it has its own server (5184).
    { name: 'problems', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5184' }, testMatch: 'problems.spec.ts' },
    // The novelties need an install that already has a training, so their own server (5185).
    { name: 'news', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5185' }, testMatch: 'news.spec.ts' },
    // The progress needs a joseki graph with weights over the start list, so its own server (5186).
    { name: 'progress', use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5186' }, testMatch: 'progress.spec.ts' },
  ],
  // Playwright starts these one after another: the first builds the web UI that the second serves too.
  webServer: [
    {
      command: `node -e "require('fs').rmSync('e2e/.data',{recursive:true,force:true});require('fs').copyFileSync('e2e/config.e2e.json','e2e/config.run.json')" && npx tsx e2e/make-traps.ts && npx tsx e2e/make-starts.ts && npm run build && npx tsx packages/server/src/main.ts`,
      url: 'http://127.0.0.1:5180/api/health',
      // JOSEKI_THRESHOLDS '': no thresholds table, whatever packages/server/bases holds: e2e uses the thresholds of its config.
      env: {
        JOSEKI_CONFIG: 'e2e/config.run.json',
        JOSEKI_TRAPS: 'e2e/traps.test.jdb',
        JOSEKI_STARTS: 'e2e/starts.test.jdb',
        JOSEKI_STARTS_LIST: 'e2e/starts-list.test.json',
        JOSEKI_STARTS_NAMES: 'e2e/starts-i18n.test.json',
        JOSEKI_THRESHOLDS: '',
        // Likewise the joseki graph and its weights: e2e does not depend on the shipped files.
        JOSEKI_GRAPH: '',
        JOSEKI_GRAPH_WEIGHTS: '',
      },
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
    {
      // Spec (languages) 9: its own profile in Russian (the language spec saves other languages), the same fake KataGo and start positions.
      command: 'npx tsx e2e/languages-server.ts',
      url: 'http://127.0.0.1:5183/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The problem flow: the fake KataGo punishes N13 by 3 points, so the user's first move there is a mistake.
      command: 'npx tsx e2e/problems-server.ts',
      url: 'http://127.0.0.1:5184/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The novelties need an install that already has a training, so their own server: its database is seeded before the first start.
      command: 'npx tsx e2e/news-server.ts',
      url: 'http://127.0.0.1:5185/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // The progress of the list: a small graph with weights for two levels, written before the first start.
      command: 'npx tsx e2e/progress-server.ts',
      url: 'http://127.0.0.1:5186/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
