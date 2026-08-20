import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const r = (p: string) => resolve(__dirname, p)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': r('src/main'),
        '@shared': r('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: r('src/main/index.ts'),
          // A second entry exposing the application graph without the app lifecycle,
          // so the end-to-end smoke test can drive the real stack inside Electron.
          context: r('src/main/context.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: r('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: r('src/renderer'),
    resolve: {
      alias: {
        '@': r('src/renderer'),
        '@shared': r('src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: { input: { index: r('src/renderer/index.html') } }
    }
  }
})
