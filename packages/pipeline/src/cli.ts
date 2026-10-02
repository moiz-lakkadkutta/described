import { Command } from 'commander'
import { ctxFor, runDescribe } from './steps'
import { writeDescriptionCuesForCli } from './cues'
const program = new Command().name('described-pipeline')
program.command('describe').requiredOption('--title <slug>').requiredOption('--source <s3uri>').option('--lang <en|de>', 'en').option('--voice <name>', 'Joanna').option('--from <step>', 'resume from step')
  .action(async (o) => {
    const input = { slug: o.title, source: o.source, language: o.lang, voice: o.voice, fromStep: o.from }
    await runDescribe(input)
    await writeDescriptionCuesForCli(o.title, ctxFor(input).work) // the worker does this in persist('finish')
    process.exit(0)
  })
program.parseAsync()
