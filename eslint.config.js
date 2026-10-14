import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.wrangler/**',
      '**/*.min.js',
      '.specify/**',
      '.claude/**',
      'specs/**',
      'apps/web/dev-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Principle I: no floating-point money handling inside the finance engine.
    files: ['packages/finance-engine/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use integer minor units.' }],
      'no-restricted-properties': [
        'error',
        { property: 'toFixed', message: 'Use integer minor units.' },
        { object: 'Number', property: 'parseFloat', message: 'Use integer minor units.' },
        { object: 'Math', property: 'round', message: 'Use allocateLargestRemainder.' },
      ],
    },
  },
);
