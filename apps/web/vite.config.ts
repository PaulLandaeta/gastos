import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Feature 005 (research R4): the user decides when to update, so a half-filled form or the
      // pending queue (IndexedDB, untouched by updates) is never lost to an automatic reload.
      registerType: 'prompt',
      workbox: {
        // Any route opens the app shell offline instead of the browser error page.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/v1\//, /^\/local-blobs\//],
        // Data is cached by Firestore and TanStack Query per account, never by the service worker.
        runtimeCaching: [],
      },
      manifest: {
        id: '/',
        scope: '/',
        name: 'Gastos de Viaje',
        short_name: 'Gastos',
        description: 'Gastos de viaje colaborativos',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f766e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  // Export libraries are loaded on demand; pre-bundle them so the dev server never reloads mid-use.
  optimizeDeps: { include: ['write-excel-file/universal', 'jspdf', 'jspdf-autotable'] },
  server: { port: 5180, strictPort: true, watch: { ignored: ['**/dist-e2e/**'] } },
});
