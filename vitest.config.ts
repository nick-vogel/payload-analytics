import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // test/e2e needs a running Payload app and a database, so it stays out of the
    // default run (the CI commit stage). Keep Vitest's default excludes.
    exclude: [...configDefaults.exclude, 'test/e2e/**'],
    server: {
      deps: {
        // @payloadcms/ui imports CSS (react-image-crop's ReactCrop.css), which Node
        // cannot load when the package is externalized. Inlining it lets Vite handle the CSS.
        inline: ['@payloadcms/ui'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'components/**/*',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    css: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'payload-analytics-plugin': resolve(__dirname, './src'),
    },
  },
})