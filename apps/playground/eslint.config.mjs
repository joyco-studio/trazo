import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import importX from 'eslint-plugin-import-x'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

// The trazo DSL plugin lives in the workspace package's build output
// (`dist/eslint`). On a clean checkout that hasn't built packages yet that file
// is absent, so resolve it lazily and degrade gracefully — linting the app must
// still run; the DSL rules simply don't apply until the package is built.
let trazoConfigs = []
try {
  const trazo = (await import('@joycostudio/trazo/eslint')).default
  trazoConfigs = [trazo.configs.recommended]
} catch (error) {
  // Only tolerate the build artifact being absent (a clean checkout that hasn't
  // built packages). Re-throw everything else — a syntax error, a missing
  // dependency, or a throw during init must fail loudly, never silently drop the
  // DSL rules while lint still reports success.
  const artifactMissing =
    (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') &&
    String(error?.message ?? '').includes('dist/eslint')
  if (!artifactMissing) throw error
  // eslint-disable-next-line no-console -- surfacing skipped DSL rules at config load
  console.warn(
    '[eslint] @joycostudio/trazo/eslint not built — skipping trazo DSL rules. Run `pnpm --filter @joycostudio/trazo build`.',
  )
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // ── Ignores ──────────────────────────────────────────────
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', '.source/**']),

  // ── Import plugin setup ──────────────────────────────────
  {
    plugins: { 'import-x': importX, 'simple-import-sort': simpleImportSort },
  },

  // ── Trazo DSL validation ─────────────────────────────────
  // Dogfoods the published plugin: any static `flow`/`git`/`seq`/`block` tagged
  // template or `parseFlow("…literal…")` call authored in app code is parsed at
  // lint time (0 findings today — the playground parses runtime editor text).
  // Empty (skipped) when the package hasn't been built; see the guard above.
  ...trazoConfigs,

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
