import path from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: path.resolve(__dirname, 'test/stubs/react-native.ts') }] },
  // the kit installs from npm into node_modules, which vitest externalises; inline it so its react-native import is stubbed
  test: { globals: true, environment: 'node', server: { deps: { inline: [/@moiz0309\/vega-media-kit/] } } },
})
