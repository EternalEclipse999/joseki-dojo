import { readFileSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'

// Spec (about) 3.1: the web code reads the app version from __APP_VERSION__, set here as in the Vite build.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
})
