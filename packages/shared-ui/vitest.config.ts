import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
// Screens render under react-test-renderer: react-native and react-tv-space-navigation are replaced by host-string
// stubs (test/stubs); the kit's focus module is taken from its source, with React deduped to this package's copy.
const require = createRequire(import.meta.url)
const kit = realpathSync(path.resolve(__dirname, 'node_modules/@moizp/vega-media-kit'))
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: path.resolve(__dirname, 'test/stubs/react-native.tsx') },
      { find: /^react-tv-space-navigation$/, replacement: path.resolve(__dirname, 'test/stubs/space-navigation.tsx') },
      { find: /^@moizp\/vega-media-kit\/focus$/, replacement: path.join(kit, 'src/focus/index.ts') },
      { find: /^react$/, replacement: path.dirname(require.resolve('react/package.json')) },
    ],
  },
  test: { globals: true },
})
