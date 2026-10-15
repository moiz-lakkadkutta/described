import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { evaluateContext, reportMarkdown, wordsFromVtt, type AnnotatedScene, type EvalCue } from './evalContext'
import { loadGlossary } from './glossary'
import { spokenNames } from './steps/05b-edit'
import type { Word } from './steps/03-speech'

/**
 * `pnpm --filter @described/pipeline eval-context --slug <slug> --before <cues.json> [--after <cues.json>] [--words <words.json> |
 * --captions <captions.vtt>] [--scenes <annotations.json>]` (DESC-029). No AWS call. A cue file is a cues.json (FitCue[]) or a list of
 * published rows ({ slug, startMs, text, extended }), filtered by --slug. --scenes is a JSON object { "<slug>": [{ startS, setting }] }
 * of hand-annotated scenes. The glossary comes from apps/api/prisma/titles.json (GLOSSARY_FILE overrides).
 */
const json = <T>(f: string) => JSON.parse(readFileSync(f, 'utf8')) as T
const cuesOf = (f: string, slug: string): EvalCue[] => json<Array<EvalCue & { slug?: string }>>(f).filter((c) => !c.slug || c.slug === slug)

/** --all: the five catalogue titles with the transcripts kept as test fixtures (Big Buck Bunny and Caminandes have no dialogue). */
const CATALOGUE: { slug: string; words?: string; captions?: string }[] = [
  { slug: 'sintel-90-150-r2', words: 'test/fixtures/sintel-90-150-r2.words.json' },
  { slug: 'big-buck-bunny-0-60' },
  { slug: 'elephants-dream-0-60', captions: 'test/fixtures/sdh/elephants-dream-0-60.captions.vtt' },
  { slug: 'caminandes-35-95' },
  { slug: 'tears-of-steel-40-100', words: 'test/fixtures/tears-of-steel-40-100.words.json' },
]

type Opts = { slug?: string; all?: boolean; before: string; after?: string; words?: string; captions?: string; scenes?: string; json?: boolean }
new Command().name('eval-context').option('--slug <slug>').option('--all', 'every catalogue title (run from packages/pipeline)').requiredOption('--before <file>').option('--after <file>').option('--words <file>').option('--captions <file>').option('--scenes <file>').option('--json', 'print the reports as JSON')
  .action((o: Opts) => {
    const titles = o.all ? CATALOGUE : o.slug ? [{ slug: o.slug, words: o.words, captions: o.captions }] : []
    if (!titles.length) throw new Error('give --slug <slug> or --all')
    const reports = titles.map((t) => {
      const glossary = loadGlossary(t.slug)
      const words = t.words ? json<Word[]>(t.words) : t.captions ? wordsFromVtt(readFileSync(t.captions, 'utf8')) : []
      const spoken = spokenNames(words, 'en')
      const scenes = o.scenes ? json<Record<string, AnnotatedScene[]>>(o.scenes)[t.slug] ?? [] : []
      const before = evaluateContext({ cues: cuesOf(o.before, t.slug), glossary, spoken, scenes })
      const after = o.after ? evaluateContext({ cues: cuesOf(o.after, t.slug), glossary, spoken, scenes }) : undefined
      return { slug: t.slug, before, after }
    })
    console.log(o.json ? JSON.stringify(reports, null, 2) : reports.map((r) => reportMarkdown(r.slug, r.before, r.after)).join('\n'))
  }).parse()
