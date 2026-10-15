// Bundles the hosted copy of the API (src/lambda.ts) for Lambda (DESC-034): `pnpm --filter @described/api build:lambda` (runs `prisma generate` first).
// Output dist-lambda/: index.js (CommonJS, Node.js 22), Prisma's query engine for linux-arm64-openssl-3.0.x and
// schema.prisma next to it (Prisma looks beside the bundle: https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-aws-lambda),
// and prisma/migrations for the function's `migrate` operation. infra/lib/viewer-stack.ts deploys this folder as is.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.join(root, 'dist-lambda')
const ENGINE = 'libquery_engine-linux-arm64-openssl-3.0.x.so.node'
const require = createRequire(import.meta.url)
const generated = path.dirname(require.resolve('.prisma/client/package.json', { paths: [path.dirname(require.resolve('@prisma/client/package.json'))] }))
if (!existsSync(path.join(generated, ENGINE))) throw new Error(`${ENGINE} missing in ${generated}: run \`pnpm db:generate\` (schema.prisma binaryTargets lists it)`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out)
await build({
  entryPoints: [path.join(root, 'src/lambda.ts')], outfile: path.join(out, 'index.js'),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: false, sourcemap: false, legalComments: 'none',
  logLevel: 'warning',
})
cpSync(path.join(generated, ENGINE), path.join(out, ENGINE))
cpSync(path.join(generated, 'schema.prisma'), path.join(out, 'schema.prisma'))
cpSync(path.join(root, 'prisma/migrations'), path.join(out, 'migrations'), { recursive: true })
console.log(`built ${path.relative(process.cwd(), out)}`)
