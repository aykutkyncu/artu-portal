import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Geliştirme sırasında API isteklerini yerel PocketBase'e yönlendir.
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'Artu Portal',
        short_name: 'Artu',
        description: 'Artu Çikolata şirket içi duyuru, planlama ve mesajlaşma',
        lang: 'tr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#faf6f1',
        theme_color: '#4a2c1d',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: API_TARGET, ws: true, changeOrigin: true },
      '/_': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: '../server/pb_public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
