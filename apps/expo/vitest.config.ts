import path from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: [{ find: /^react-native$/, replacement: path.resolve(__dirname, 'test/stubs/react-native.ts') }] },
  test: { globals: true, environment: 'node' },
})
