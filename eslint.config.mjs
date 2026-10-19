// One flat config for the monorepo. Each package's `lint` script runs `eslint src` from its own directory and
// ESLint 9 finds this file by walking up. typescript-eslint parses TS/TSX; rules are its non-type-checked set.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Vega OS runs only JS and the native libraries Amazon supports there, so shared-ui may import only these; anything
// native goes in apps/expo or apps/vega. react-tv-space-navigation is allowed because it is pure JS (no android/ or ios/
// folders; its dependencies are @bam.tech/lrud and lodash.uniqueid) and it is the focus library of the AmazonAppDev
// multi-TV sample that targets Fire OS and Vega.
const SHARED_UI_ALLOWED = [
  'react',
  'react-native',
  'react-tv-space-navigation',
  '@described/contracts',
  '@moiz0309/vega-media-kit'
]
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const allowed = `^(?:\\.|(?:${SHARED_UI_ALLOWED.map(escape).join('|')})(?:/|$))`
const notAllowed = {
  regex: `^(?!${allowed.slice(1)})`,
  message: `Not on shared-ui's Vega-safe list (${SHARED_UI_ALLOWED.join(', ')}). Use @moiz0309/vega-media-kit ` +
    '(player/platform) or put platform code in apps/expo or apps/vega.'
}
// A relative import that climbs out of packages/shared-ui (to apps/ or another package) would skip the list above, so
// for a file `depth` folders below src/, `../` repeated depth + 2 times or more is refused.
const escapesPackage = (depth) => ({
  regex: `^(?:\\.\\./){${depth + 2},}`,
  message: 'Relative import leaves packages/shared-ui; import a listed package instead.'
})
const sharedUiDepths = [0, 1, 2, 3]

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
  ...sharedUiDepths.map((depth) => ({
    files: [`packages/shared-ui/src/${'*/'.repeat(depth)}*.{ts,tsx}`],
    rules: { 'no-restricted-imports': ['error', { patterns: [notAllowed, escapesPackage(depth)] }] }
  })),
  {
    // Deeper than src/*/*/*/: the allowlist still applies; the escape check above does not reach here.
    files: [`packages/shared-ui/src/${'*/'.repeat(sharedUiDepths.length)}**/*.{ts,tsx}`],
    rules: { 'no-restricted-imports': ['error', { patterns: [notAllowed] }] }
  }
)
