import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { execa } from 'execa'
import { readFile, writeFile } from 'node:fs/promises'
import type { Ctx } from './index'
import type { Shot } from './02-shots'
import type { Gap } from './03-speech'
import { describeSystemPrompt, wordBudget } from '../prompts'

export interface Described extends Shot { description: string; sameAsPrev: boolean; tokens: number }

/**
 * Nova Pro per shot, via the Converse API with the shot clip as an S3 URI (us-east-1 ingest bucket).
 * Parallelism 4. Short-circuits with "SAME" when nothing new is visible.
 * Orchestration note: this is the function the Strands agent calls as a tool (see ../agent).
 */
export async function describeShots(ctx: Ctx) {
  const shots = JSON.parse(await readFile(`${ctx.work}/shots.json`, 'utf8')) as Shot[]
  const gaps = JSON.parse(await readFile(`${ctx.work}/gaps.json`, 'utf8')) as Gap[]
  const ingest = process.env.S3_BUCKET_NOVA_INGEST!
  const client = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })
  const out: Described[] = []
  let prev = ''
  const known: string[] = [] // names heard so far — filled from words.json speaker turns in DESC-003
  for (const s of shots) {
    const key = `${ctx.slug}/shot_${s.index}.mp4`
    await execa('aws', ['s3', 'cp', `${ctx.work}/shot_${s.index}.mp4`, `s3://${ingest}/${key}`, '--region', 'us-east-1', '--content-type', 'video/mp4'], { stdio: 'ignore' })
    const budget = wordBudget(s, gaps)
    const r = await client.send(new ConverseCommand({
      modelId: process.env.NOVA_PRO_MODEL_ID ?? 'amazon.nova-pro-v1:0',
      system: [{ text: describeSystemPrompt({ maxWords: budget, knownNames: known, language: ctx.language }) }],
      messages: [{ role: 'user', content: [
        { text: `Previous shot: "${prev || '(start of film)'}". Describe this shot.` },
        { video: { format: 'mp4', source: { s3Location: { uri: `s3://${ingest}/${key}` } } } },
      ] }],
      inferenceConfig: { maxTokens: 120, temperature: 0.2 },
    }))
    const text = (r.output?.message?.content?.[0]?.text ?? '').trim()
    const same = /^SAME\.?$/i.test(text)
    out.push({ ...s, description: same ? '' : text, sameAsPrev: same, tokens: r.usage?.inputTokens ?? 0 })
    if (!same) prev = text
  }
  await writeFile(`${ctx.work}/described.json`, JSON.stringify(out, null, 2))
}
