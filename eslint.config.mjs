// One flat config for the monorepo. Each package's `lint` script runs `eslint src` from its own directory and
// ESLint 9 finds this file by walking up. typescript-eslint parses TS/TSX; rules are its non-type-checked set.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Vega OS runs only JS and the native libraries Amazon supports there (docs/decisions/0004-vega-deferred.md keeps this
// rule so the Vega path stays open). shared-ui may import only these; anything native goes in apps/expo or apps/vega.
const SHARED_UI_ALLOWED = [
  'react',
  'react-native',
  'react-tv-space-navigation',
  '@described/contracts',
  '@moiz0309/vega-media-kit'
]
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const allowed = `^(?:\\.|(?:${SHARED_UI_ALLOWED.map(escape).join('|')})(?:/|$))`

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/.expo/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-control-regex': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    // Metro bundles static assets through require() (fonts, images).
    files: ['apps/expo/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    files: ['packages/shared-ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: `^(?!${allowed.slice(1)})`,
          message: `Not on shared-ui's Vega-safe list (${SHARED_UI_ALLOWED.join(', ')}). Use @moiz0309/vega-media-kit ` +
            '(player/platform) or put platform code in apps/expo or apps/vega.'
        }]
      }]
    }
  }
)
