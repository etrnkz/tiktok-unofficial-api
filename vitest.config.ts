import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['verbose'],
    typecheck: {
      enabled: true
    }
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})
