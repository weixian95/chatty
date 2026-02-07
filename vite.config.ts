import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE || '/'

  return {
    base,
    plugins: [vue()],
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: '@use "styles/breakpoints" as *;',
          loadPaths: [path.resolve(__dirname, 'src')],
        },
      },
    },
  }
})
