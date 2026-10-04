import { Command } from 'commander'
import { ctxFor, runDescribe } from './steps'
import { writeDescriptionCuesForCli } from './cues'
import { resolveLanguageAndVoice } from './steps/06-voice'
import { promptOptions, synthesizePrompts } from './promptClips'
const program = new Command().name('described-pipeline')
program.command('describe').requiredOption('--title <slug>').requiredOption('--source <s3uri>').option('--lang <en|de>', 'language of the title', 'en').option('--voice <name>', 'Polly voice (default: POLLY_VOICE_EN/DE, else Joanna/Vicki)').option('--from <step>', 'resume from step')
  .action(async (o) => {
    const { language, voice } = resolveLanguageAndVoice({ lang: o.lang, voice: o.voice })
    const input = { slug: o.title, source: o.source, language, voice, fromStep: o.from }
    await runDescribe(input)
    await writeDescriptionCuesForCli(o.title, ctxFor(input).work) // the worker does this in persist('finish')
    process.exit(0)
  })
// App-voice prompt clips (DESC-010). A dry run by default: prints the texts and the Polly estimate, no AWS call. --run pays.
program.command('prompts').option('--voice <names>', 'comma-separated voices (default: all four)').option('--out <dir>', 'local output dir', 'work/prompts')
  .option('--no-upload', 'write the MP3s locally only').option('--run', 'call Polly (paid) and upload; without it this is a dry run').option('--dry-run', 'print the plan only (the default)')
  .action(async (o) => {
    const opts = promptOptions(o)
    const r = await synthesizePrompts(opts)
    for (const c of r.clips) console.log(`${c.voice.padEnd(8)}${c.key.padEnd(14)}${c.language}  ${c.s3Key}\n    ${c.text}`)
    console.log(`${r.clips.length} clips, ${r.chars} characters, ≈ $${r.usd.toFixed(4)} (Polly neural)`)
    if (opts.dryRun) console.log('dry run: no Polly call, nothing written or uploaded. Add --run to synthesize and upload.')
    else console.log(`wrote ${r.written.length}, uploaded ${r.uploaded.length}`)
    process.exit(0)
  })
program.parseAsync()
