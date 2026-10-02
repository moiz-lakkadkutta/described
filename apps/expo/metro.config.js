// Metro for a pnpm monorepo plus the linked vega-media-kit — friction 2026-09-26 "Metro exports condition order".
// https://docs.expo.dev/guides/monorepos/ · https://metrobundler.dev/docs/resolution/ · https://metrobundler.dev/docs/package-exports/
const { getDefaultConfig } = require('expo/metro-config')
const fs = require('fs')
const path = require('path')

const app = __dirname
const root = path.resolve(app, '../..')
const sharedUi = path.join(root, 'packages/shared-ui')
const kit = fs.realpathSync(path.join(app, 'node_modules/@moizp/vega-media-kit')) // link: override → outside the repo
const kitPkg = require(path.join(kit, 'package.json'))
const esc = (p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')

const config = getDefaultConfig(app)
config.watchFolders = [root, kit]
config.resolver.nodeModulesPaths = [path.join(app, 'node_modules'), path.join(root, 'node_modules')]
config.resolver.unstable_enableSymlinks = true // pnpm: every package is a symlink into node_modules/.pnpm
// The kit's own node_modules hold its dev copies of react / react-native: never bundle them (duplicate React).
config.resolver.blockList = [].concat(config.resolver.blockList ?? [], [new RegExp(`^${esc(path.join(kit, 'node_modules'))}[/\\\\].*`)])

// One copy each in the bundle, resolved from the package that depends on it.
const singletons = { react: app, 'react-native': app, 'react-native-video': app, 'react-tv-space-navigation': sharedUi }
// The kit's Vega adapter requires these lazily; they don't exist on Fire OS, so they bundle as empty modules.
const otherPlatform = ['@amazon-devices/', 'shaka-player']
const from = (context, dir) => ({ ...context, originModulePath: path.join(dir, 'package.json') })

config.resolver.resolveRequest = (context, name, platform) => {
  // Kit entry points → its `react-native` source condition (src/*.ts), never dist/, whatever the exports key order.
  if (name === kitPkg.name || name.startsWith(`${kitPkg.name}/`)) {
    const entry = kitPkg.exports[`.${name.slice(kitPkg.name.length)}`]?.['react-native']
    if (entry) return { type: 'sourceFile', filePath: path.join(kit, entry) }
  }
  if (otherPlatform.some((p) => name.startsWith(p))) return { type: 'empty' }
  const bare = name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/')
  if (singletons[bare]) return context.resolveRequest(from(context, singletons[bare]), name, platform)
  // Anything else the kit imports bare resolves against the app's dependencies.
  if (context.originModulePath.startsWith(kit + path.sep) && !name.startsWith('.')) return context.resolveRequest(from(context, app), name, platform)
  return context.resolveRequest(context, name, platform)
}

module.exports = config
