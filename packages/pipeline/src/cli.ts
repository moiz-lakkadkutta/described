import { Command } from 'commander'
import { runDescribe } from './steps'
const program = new Command().name('described-pipeline')
program.command('describe').requiredOption('--title <slug>').requiredOption('--source <s3uri>').option('--lang <en|de>', 'en').option('--voice <name>', 'Joanna').option('--from <step>', 'resume from step')
  .action(async (o) => { await runDescribe({ slug: o.title, source: o.source, language: o.lang, voice: o.voice, fromStep: o.from }); process.exit(0) })
program.parseAsync()
