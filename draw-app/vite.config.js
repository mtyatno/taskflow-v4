import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/static/vendor/tldraw/',
  build: {
    outDir: '../static/vendor/tldraw',
    emptyOutDir: true,
  }
})
