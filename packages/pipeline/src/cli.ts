import { Command } from 'commander'
import { runDescribe } from './steps'
import { resolveLanguageAndVoice } from './steps/06-voice'
const program = new Command().name('described-pipeline')
program.command('describe').requiredOption('--title <slug>').requiredOption('--source <s3uri>').option('--lang <en|de>', 'language of the title', 'en').option('--voice <name>', 'Polly voice (default: POLLY_VOICE_EN/DE, else Joanna/Vicki)').option('--from <step>', 'resume from step')
  .action(async (o) => { const { language, voice } = resolveLanguageAndVoice({ lang: o.lang, voice: o.voice }); await runDescribe({ slug: o.title, source: o.source, language, voice, fromStep: o.from }); process.exit(0) })
program.parseAsync()
