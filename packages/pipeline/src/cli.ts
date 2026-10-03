import { Command } from 'commander'
import { ctxFor, runDescribe } from './steps'
import { writeDescriptionCuesForCli } from './cues'
import { resolveLanguageAndVoice } from './steps/06-voice'
const program = new Command().name('described-pipeline')
program.command('describe').requiredOption('--title <slug>').requiredOption('--source <s3uri>').option('--lang <en|de>', 'language of the title', 'en').option('--voice <name>', 'Polly voice (default: POLLY_VOICE_EN/DE, else Joanna/Vicki)').option('--from <step>', 'resume from step')
  .action(async (o) => {
    const { language, voice } = resolveLanguageAndVoice({ lang: o.lang, voice: o.voice })
    const input = { slug: o.title, source: o.source, language, voice, fromStep: o.from }
    await runDescribe(input)
    await writeDescriptionCuesForCli(o.title, ctxFor(input).work) // the worker does this in persist('finish')
    process.exit(0)
  })
program.parseAsync()
