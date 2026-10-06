import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// The server listens on 127.0.0.1:5179 by default; in development Vite proxies API calls to it.
const SERVER = 'http://127.0.0.1:5179'

export default defineConfig({
  plugins: [preact()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': SERVER, '/ws': { target: SERVER, ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
