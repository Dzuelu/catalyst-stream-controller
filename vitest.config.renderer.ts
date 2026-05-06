import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import path from 'path';

export default defineConfig({
  plugins: [svelte({ hot: false }), svelteTesting()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/components/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup-renderer.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/renderer/**/*.{ts,svelte}'],
      exclude: ['**/*.d.ts'],
      reporter: ['text', 'lcov']
    }
  }
});
