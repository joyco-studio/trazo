import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import importX from 'eslint-plugin-import-x'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── Ignores ──────────────────────────────────────────────
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),

  // ── Import plugin setup ──────────────────────────────────
  {
    plugins: { 'import-x': importX, 'simple-import-sort': simpleImportSort },
  },

  // ── Rules ────────────────────────────────────────────────
  {
    rules: {
      // --- Overrides from Next config ---
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',

      // --- Consistency (auto-fixable, low friction) ---
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      'import-x/no-duplicates': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react/self-closing-comp': 'warn',
      'react/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'never' }],

      // --- Bug prevention (gentle) ---
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['warn', 'always', { null: 'ignore' }],

      // --- Perf-aware: block heavy / full-lib imports ---
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'lodash',
              message: 'Prefer importing specific utils instead lodash/[util].',
            },
            {
              name: 'moment',
              message: 'Use date-fns or dayjs instead — moment is 300kb+ and mutable.',
            },
          ],
        },
      ],

      // --- Perf-aware: flag known costly patterns ---
      // Points devs to the render pipeline doc when they use drawSVG
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'Literal[value=/drawSVG/i]',
          message:
            'drawSVG triggers layout+paint on every frame. Consider a transform-based alternative. See: https://hub.joyco.studio/logs/12-the-render-pipeline',
        },
        {
          selector: 'TemplateLiteral[quasis.0.value.raw=/drawSVG/i]',
          message:
            'drawSVG triggers layout+paint on every frame. Consider a transform-based alternative. See: https://hub.joyco.studio/logs/12-the-render-pipeline',
        },
      ],
    },
  },
])

export default eslintConfig
