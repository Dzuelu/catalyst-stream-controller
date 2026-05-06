import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // ── Entry points ────────────────────────────────────────────
  entry: [
    'src/main/index.ts', // Electron main process
    'src/preload/preload.ts', // Electron preload
    'forge.config.ts' // Electron Forge config
  ],

  // ── Project files (source boundary) ─────────────────────────
  project: ['src/**/*.{ts,svelte}'],

  // ── Plugin overrides ────────────────────────────────────────
  vitest: {
    entry: [
      'tests/**/*.test.ts', // All test files
      'tests/setup.ts', // Unit test setup
      'tests/setup-renderer.ts' // Component test setup
    ]
  },

  // ── Ignore specific dependencies ───────────────────────────
  // These are referenced in config files or loaded at runtime
  ignoreDependencies: [
    '@electron-forge/*',
    'midi', // Optional native MIDI dep loaded at runtime
    '@tailwindcss/vite', // Used in vite.renderer.config.ts
    'tailwindcss', // Used via @import in CSS
    'prettier-plugin-svelte' // Referenced as string in ESLint config
  ]
};

export default config;
