// Usage: pnpm friction "vega sdk rosetta"  → docs/friction/2026-09-15-vega-sdk-rosetta.md
import { writeFileSync, existsSync } from 'node:fs'
const slug = (process.argv.slice(2).join(' ') || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const date = new Date().toISOString().slice(0, 10)
const path = `docs/friction/${date}-${slug}.md`
if (existsSync(path)) { console.error('exists:', path); process.exit(1) }
writeFileSync(path, `# ${slug.replace(/-/g, ' ')}

Task attempted:
Steps:
  1.
  2.
Expected:
Actual:
Severity: (Low | Medium | High — minutes lost, who it blocks)
Workaround:
Suggestion:
Environment: (OS, SDK version, device)
Links:
`)
console.log('created', path)
