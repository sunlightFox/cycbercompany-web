import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = process.env.VITE_DEV_PROXY_TARGET || env.VITE_DEV_PROXY_TARGET || 'http://localhost:8080'
  return {
    plugins: [react()],
    build: {
      rolldownOptions: {
        output: {
          manualChunks(moduleId) {
            if (moduleId.includes('react-markdown') || moduleId.includes('remark-gfm')) return 'markdown'
            if (moduleId.includes('@radix-ui/')) return 'radix'
            return undefined
          },
        },
      },
    },
    server: {
      // Docker on Windows does not reliably forward bind-mount file events to Vite.
      // Polling keeps the browser under test aligned with local source changes.
      watch: {
        usePolling: true,
        interval: 300,
      },
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
