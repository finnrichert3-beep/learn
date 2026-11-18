import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so dist/ works at a domain root, a sub-path, or a preview URL.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
