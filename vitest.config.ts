import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    // Forks isolate the module graph per file; the suite touches the real
    // filesystem (package.json) rather than a shared worker heap.
    pool: 'forks',
  },
})
