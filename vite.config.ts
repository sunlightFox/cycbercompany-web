import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
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
      proxy: {
        '/api': {
          target: env.VITE_DEV_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
