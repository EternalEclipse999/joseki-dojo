import { readFileSync } from 'node:fs'
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// The server listens on 127.0.0.1:5179 by default; in development Vite proxies API calls to it.
const SERVER = 'http://127.0.0.1:5179'

// Spec (about) 3.1: the app version is the root package.json version, as for electron-builder.
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': SERVER, '/ws': { target: SERVER, ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
