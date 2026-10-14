import type { ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime'
import type { Setting } from '@described/contracts'
import { LITE } from './prompts'

/**
 * The scene-grouping request (DESC-029, steps/04c-scenes.ts, docs/decisions/0012-characters-and-scenes.md): one text-only Nova Lite
 * call over the shot descriptions groups consecutive shots into scenes and names each scene's place in words taken from those
 * descriptions or from the title's listed places. Its own module, like verifyPrompt.ts, so it changes independently of prompts.ts.
 * Forced tool: https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html ·
 * https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html
 * Converse: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 */
export const scenesModelId = () => process.env.SCENES_MODEL_ID ?? LITE()

/** JSON Schema for the forced emit_scenes tool's input (Nova: a top-level object with type, properties, required). */
export const SCENES_TOOL_SCHEMA = {
  type: 'object', required: ['scenes'],
  properties: { scenes: { type: 'array', description: 'Every shot in exactly one scene, scenes in time order', items: { type: 'object', required: ['firstShot', 'lastShot', 'setting'], properties: {
    firstShot: { type: 'integer', description: 'The first shot number of the scene' },
    lastShot: { type: 'integer', description: 'The last shot number of the scene' },
    setting: { type: 'string', description: 'Where the scene is, 1–4 words taken from its shot descriptions or the listed places' },
  } } } },
}

export interface SceneShotInput { shot: number; start: number; description: string }

/** The request: rules in the system prompt, data first in the user turn and the task last (as sdhRequest found Nova Lite needs); temperature 0, topK 1. */
export function scenesRequest(shots: readonly SceneShotInput[], settings: readonly Pick<Setting, 'name' | 'look'>[], language: 'en' | 'de', mode: 'tool' | 'json' = 'tool'): ConverseCommandInput {
  const input = JSON.stringify({ language, shots, ...(settings.length ? { places: settings.map((s) => ({ name: s.name, look: s.look })) } : {}) })
  return {
    modelId: scenesModelId(),
    system: [{ text: [
      'You group the shots of a film into scenes for an audio describer. Each shot was described on its own, in time order.',
      'A scene is a run of consecutive shots in one place and time. Start a new scene only where the place or the time changes (a cut to another place, "Night.", "40 YEARS LATER"); cuts between people in one place stay in one scene. A return to an earlier place is a new scene.',
      'For each scene give its first and last shot number and its setting: 1–4 words saying where it is, taken only from the descriptions of that scene\'s shots or from the names of the listed places. Never guess a place no description or listed place states; if none is stated, use the words of the closest description that hints at it.',
      mode === 'tool'
        ? 'Return every shot in exactly one scene, in order, through the emit_scenes tool.'
        : 'Reply with one JSON object only, exactly {"scenes":[{"firstShot":<n>,"lastShot":<n>,"setting":"<words>"}]} — no prose, no code fence — with every shot in exactly one scene, in order.',
    ].join('\n') }],
    messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\n${mode === 'tool' ? 'Use the emit_scenes tool to return the scenes.' : 'Reply with the JSON object {"scenes":[…]} only.'}` }] }],
    ...(mode === 'tool' ? { toolConfig: { tools: [{ toolSpec: { name: 'emit_scenes', description: 'Return the scenes', inputSchema: { json: SCENES_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_scenes' } } } } : {}),
    inferenceConfig: { maxTokens: 1500, temperature: 0 },
    additionalModelRequestFields: { inferenceConfig: { topK: 1 } },
  }
}
