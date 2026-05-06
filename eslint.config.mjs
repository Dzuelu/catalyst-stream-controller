import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import prettier from 'eslint-plugin-prettier/recommended';
import unusedImports from 'eslint-plugin-unused-imports';

const prettierConfig = {
  singleQuote: true,
  trailingComma: 'none',
  printWidth: 120,
  tabWidth: 2,
  semi: true,
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf'
};

export default tseslint.config(
  // ── Global ignores ──────────────────────────────────────────
  {
    ignores: ['node_modules/', 'dist/', 'out/', '.vite/', 'vitest.config*.ts']
  },

  // ── Base JS recommended rules ───────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommended (type-aware) ─────────────────────
  ...tseslint.configs.recommended,

  // ── Svelte ──────────────────────────────────────────────────
  ...svelte.configs['flat/recommended'],

  // ── Svelte + TypeScript integration ─────────────────────────
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },

  // ── Global language options ─────────────────────────────────
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        // Electron Forge globals
        MAIN_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        MAIN_WINDOW_VITE_NAME: 'readonly'
      }
    }
  },

  // ── Project-wide rules ──────────────────────────────────────
  {
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // ─ Discourage `any` ─────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',

      // ─ Auto-fixable style rules ─────────────────────────────
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],

      // ─ Allow unused vars when prefixed with _ ───────────────
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],

      // ─ Catch & auto-remove dead imports (auto-fix) ──────────
      'unused-imports/no-unused-imports': 'error',

      // ─ Prefer const over let when not reassigned (auto-fix) ─
      'prefer-const': 'warn',

      // ─ Turned off in favour of @typescript-eslint version ───
      'no-unused-vars': 'off',

      // ─ Disallow console.log in production code (warn only) ──
      // Intentionally off — we use console for device logging
      'no-console': 'off',

      // ─ Svelte-specific ──────────────────────────────────────
      'svelte/no-at-html-tags': 'warn'
    }
  },

  // ── Test files — Vitest globals ─────────────────────────────
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // ── Prettier (must be last to override formatting rules) ────
  prettier,
  { rules: { 'prettier/prettier': ['error', prettierConfig] } },
  {
    files: ['**/*.svelte'],
    rules: {
      'prettier/prettier': [
        'error',
        {
          ...prettierConfig,
          plugins: ['prettier-plugin-svelte'],
          parser: 'svelte'
        }
      ],
      // ── Svelte files — use base no-unused-vars to avoid crash ──
      // @typescript-eslint/no-unused-vars crashes on Svelte $: label defs
      // (defToVariableType returns undefined for Svelte-specific AST nodes)
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_|^\\$',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  }
);
