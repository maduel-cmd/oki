import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  envDir: __dirname,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'אוקי משפחה',
        short_name: 'אוקי',
        description: 'אוקי־אוקי משפחתי עם אזורי בית והתראות מיקום',
        theme_color: '#0B3D3D',
        background_color: '#F3F6F5',
        display: 'standalone',
        lang: 'he',
        dir: 'rtl',
        start_url: '/',
        orientation: 'portrait',
        categories: ['social', 'utilities'],
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cacheId: 'oki-family-standalone-v1',
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'oki-map-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
          {
            urlPattern: /^https:\/\/protomaps\.github\.io\/basemaps-assets\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'oki-map-glyphs',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@oki/i18n': path.resolve(__dirname, 'src/lib/i18n'),
      '@oki/domain': path.resolve(__dirname, 'src/lib/domain'),
      '@oki/api': path.resolve(__dirname, 'src/lib/api'),
      '@oki/live': path.resolve(__dirname, 'src/lib/live'),
      '@oki/maps': path.resolve(__dirname, 'src/lib/maps'),
    },
  },
  server: {
    port: 5174,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          livekit: ['livekit-client'],
          maplibre: ['maplibre-gl'],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
