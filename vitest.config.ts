import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      paper: fileURLToPath(new URL('./node_modules/paper/dist/paper-core.js', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // Geometry is deliberately DOM-free so it can be tested in plain node.
    // Suites that genuinely need a DOM opt in per-file with
    // `// @vitest-environment happy-dom`.
    environment: 'node',
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: { provider: 'v8', reportsDirectory: './coverage' },
  },
})
