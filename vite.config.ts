import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const r = (p: string) => resolve(import.meta.dirname, p)

/** The browser app. `npm run dev` serves it with `/api` proxied to the local API server. */
export default defineConfig({
  root: r('src/renderer'),
  resolve: { alias: { '@': r('src/renderer'), '@shared': r('src/shared') } },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: r('.vercel/output/static'),
    emptyOutDir: true,
    rollupOptions: { input: { index: r('src/renderer/index.html') } }
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: false } }
  }
})
