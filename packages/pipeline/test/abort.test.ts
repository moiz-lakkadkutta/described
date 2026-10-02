/** The job's abort signal reaches every Bedrock call: describe (via ctx.signal) and the Nova Lite helpers (via the job's meter). */
const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ input: unknown; opts: { abortSignal?: AbortSignal } | undefined }> }))
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class { async send(cmd: { input: unknown }, opts?: { abortSignal?: AbortSignal }) { sent.push({ input: cmd.input, opts }); return { output: { message: { content: [{ text: 'Snow falls.' }] } }, usage: { inputTokens: 1, outputTokens: 1 } } } },
  ConverseCommand: class { constructor(public input: unknown) {} },
}))
import { bedrockConverse } from '../src/steps/04-describe'
import { shortenWithNovaLite } from '../src/prompts'
import { metered } from '../src/cost'

describe('abort signal', () => {
  beforeEach(() => { sent.length = 0 })
  it('is passed to Converse for describe', async () => {
    const ac = new AbortController()
    await bedrockConverse(ac.signal)({ modelId: 'qwen.qwen3-vl-235b-a22b', messages: [] })
    expect(sent[0]!.opts?.abortSignal).toBe(ac.signal)
  })
  it('is passed to the Nova Lite shortener from the job it runs in', async () => {
    const ac = new AbortController()
    await metered(() => shortenWithNovaLite('Snow falls on the hills.', 2, 'en'), ac.signal)
    expect(sent[0]!.opts?.abortSignal).toBe(ac.signal)
  })
})
