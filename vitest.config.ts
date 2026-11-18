import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node: @iwsdk/core re-exports Three.js, and the
// game logic under test only needs the Three.js maths/geometry classes.
export default defineConfig({
  resolve: {
    alias: { '@iwsdk/core': 'three' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
  },
});
