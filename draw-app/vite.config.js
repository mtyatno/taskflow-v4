import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/static/vendor/tldraw/',
  build: {
    outDir: '../static/vendor/tldraw',
    emptyOutDir: true,
    // Nama file output STABIL (tanpa hash) supaya service worker bisa mem-precache
    // bundle utama dengan nama tetap (offline-first). public/ (aset tldraw vendor)
    // tetap di-copy apa adanya ke output.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/index.[ext]',
      },
    },
  },
})
