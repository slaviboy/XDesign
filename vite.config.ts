import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

/**
 * Strip the legacy .woff fallback from the bundled @fontsource CSS.
 *
 * Each face ships both woff2 and woff, and Vite emits whichever the CSS
 * references — so keeping the fallback doubles the font payload (4.2MB of 15MB)
 * for browsers that have not existed since 2016. Every engine that can run this
 * app supports woff2.
 *
 * Runs with enforce: 'pre' so the url() is gone before Vite's CSS plugin
 * resolves it, which is what prevents the .woff files being emitted at all.
 */
function dropWoffFallback(): Plugin {
  return {
    name: 'xdesign:drop-woff-fallback',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.css') || !id.includes('@fontsource')) return null
      const next = code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '')
      return next === code ? null : { code: next, map: null }
    },
  }
}

// `base: './'` keeps every emitted URL relative, so the same build works from
// `vite preview`, from a plain static host, and from a GitHub Pages project
// subpath (user.github.io/repo/) with no rebuild.
export default defineConfig({
  base: './',
  plugins: [
    dropWoffFallback(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: null,
      registerType: 'prompt',
      manifest: {
        name: 'XDesign — Vector Design Editor',
        short_name: 'XDesign',
        description: 'Offline-first vector design editor. No account, no server, no network.',
        theme_color: '#2f2f2f',
        background_color: '#f4f4f4',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // A classic worker rather than an ES module: module service workers are
        // still uneven across engines, and nothing in sw.ts needs imports.
        rollupFormat: 'iife',
        // Workbox's default glob covers only js/css/html. Fonts and wasm would be
        // left out of the precache and the app would break on a cold offline boot.
        globPatterns: ['**/*.{js,css,html,woff2,woff,ttf,otf,wasm,png,jpg,svg,json,ico}'],
        // Default is 2 MiB and files above it are dropped *silently*.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `paper`'s main entry is paper-full, which bundles the PaperScript compiler
      // (acorn) and scans the DOM on load. paper-core is the headless subset.
      paper: fileURLToPath(new URL('./node_modules/paper/dist/paper-core.js', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: ['svgpath', 'dompurify', 'idb', 'immer', 'zustand'],
    exclude: ['paper'],
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('paper') || id.includes('polyclip')) return 'geometry-heavy'
            if (id.includes('react')) return 'react'
          }
          return undefined
        },
      },
    },
  },
  server: { port: 5173, strictPort: false },
})
