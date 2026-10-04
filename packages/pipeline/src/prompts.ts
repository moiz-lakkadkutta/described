import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime'
import { z } from 'zod'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Shot } from './steps/02-shots'
import type { Gap } from './steps/03-speech'
import type { FitCue, } from './steps/05-fit'
import { LATE_MS, WPS } from './steps/05-fit'
import { meter } from './cost'

/**
 * The description prompt — Netflix / Prime Video / DCMP rules, encoded. Changing this is a product decision; note it in docs/decisions.
 * Gate C (approved 2026-10-01): on-screen text only when legible, an explicit darkness rule, and no SAME rule — "nothing new"
 * is decided by parseDescription in 04-describe, which no longer shows the model the previous description.
 */
export function describeSystemPrompt({ maxWords, knownNames, language }: { maxWords: number; knownNames: string[]; language: 'en' | 'de' }) {
  return [
    `You write audio description for blind and low-vision viewers. Reply in ${language === 'de' ? 'German' : 'English'}. Follow these rules exactly.`,
    '- Present tense, active voice, third person. Describe only what is visible; never motivation or emotion words: write "clenches her fists", not "is angry".',
    `- Do not name a character until the dialogue has named them; until then use one stable visible descriptor (e.g. "the woman in the red coat"). Known names so far: ${knownNames.join(', ') || 'none'}.`,
    '- Precise colours (olive, burgundy). Mention scene changes ("Night. A rooftop.").',
    '- On-screen text: only if letters are clearly legible in the frames, quote them verbatim after "Words appear:". If no legible text is visible, do not mention text at all. Never invent text.',
    '- If the frames are dark or nearly black, say only what can be made out, e.g. "Darkness." or "Darkness. A faint red glow."',
    '- No interpretation, no film language ("the camera pans"), no "we see".',
    `- Output: one line, at most ${maxWords} words, no preamble, no quotes.`,
  ].join('\n')
}

/**
 * Words for the largest gap overlapping the shot window [start, end + LATE_MS] at 160 wpm (the gaps fit() can use); floor 4, cap 25. No gap → 25 (extended).
 * The budget is bounded by the shot window on purpose, so fast-cut shots don't steal the next shots' room.
 */
export function wordBudget(shot: Shot, gaps: Gap[]): number {
  const windowEnd = shot.endMs + LATE_MS
  const availMs = Math.max(0, ...gaps.map((g) => Math.min(g.endMs, windowEnd) - Math.max(g.startMs, shot.startMs)))
  if (availMs <= 0) return 25
  return Math.max(4, Math.min(25, Math.floor((availMs / 1000) * WPS)))
}

const client = () => new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? 'us-east-1' })
const LITE = () => process.env.NOVA_LITE_MODEL_ID ?? 'amazon.nova-lite-v1:0'

/** The model half of fit's shortening; fit accepts its reply only through safeShorten (no new content words). */
export async function shortenWithNovaLite(text: string, maxWords: number, language: 'en' | 'de'): Promise<string> {
  const r = await client().send(new ConverseCommand({ modelId: LITE(), system: [{ text: `Shorten audio description to at most ${maxWords} words. Remove adjectives first, then clauses. Keep present tense and the most plot-relevant fact. ${language === 'de' ? 'German.' : 'English.'} Reply with the sentence only.` }], messages: [{ role: 'user', content: [{ text }] }], inferenceConfig: { maxTokens: 80, temperature: 0 } }), { abortSignal: meter()?.signal })
  meter()?.bedrock(LITE(), r.usage)
  return (r.output?.message?.content?.[0]?.text ?? text).trim()
}

/** JSON Schema for the forced emit_sdh tool's input. */
export const SDH_TOOL_SCHEMA = {
  type: 'object', required: ['cues'],
  properties: { cues: { type: 'array', items: { type: 'object', required: ['id', 'start', 'end', 'text'], properties: { id: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, text: { type: 'string' }, speaker: { type: 'string' }, sound: { type: 'boolean' } } } } },
}

/** Captions per SDH call (DESC-014): one Converse call with every caption of a full-length title overflowed maxTokens 4000. */
export const SDH_CHUNK_CAPTIONS = 40
/** Seconds of description context either side of a window. */
const SDH_CONTEXT_S = 5

/**
 * Splits captions into windows of ≤ max, in order. A window that must split ends at the latest caption followed by a gap ≥ splitGapS
 * within its first max captions (a pause between conversations); with no such gap it ends at max.
 */
export function chunkCaptions(captions: Cue[], max = SDH_CHUNK_CAPTIONS, splitGapS = 1): Cue[][] {
  const out: Cue[][] = []
  let i = 0
  while (i < captions.length) {
    let j = Math.min(captions.length, i + max) // exclusive end
    if (j < captions.length) for (let k = j; k > i + 1; k--) if (captions[k]!.start - captions[k - 1]!.end >= splitGapS) { j = k; break }
    out.push(captions.slice(i, j))
    i = j
  }
  return out
}

/** The Converse call SDH makes; injectable so tests replay recorded replies. */
export type SdhConverse = (input: ConverseCommandInput) => Promise<Pick<ConverseCommandOutput, 'output' | 'usage'>>
const bedrockSend: SdhConverse = (i) => client().send(new ConverseCommand(i), { abortSignal: meter()?.signal })

/** One window's request: its captions and the descriptions overlapping [start − 5 s, end + 5 s]. */
function sdhRequest(window: Cue[], descriptions: FitCue[], language: 'en' | 'de'): ConverseCommandInput {
  const from = window[0]!.start - SDH_CONTEXT_S, to = window.at(-1)!.end + SDH_CONTEXT_S
  const near = descriptions.filter((d) => d.startMs / 1000 < to && d.endMs / 1000 > from)
  const input = JSON.stringify({ language, captions: window.map(({ id, start, end, text, speaker }) => ({ id, start, end, text, speaker })), descriptions: near.map((d) => ({ start: d.startMs / 1000, text: d.text })) })
  return {
    modelId: LITE(),
    system: [{ text: [
      'You produce SDH (subtitles for the deaf and hard of hearing) from plain captions, following Netflix SDH conventions.',
      'Return only (a) sound cues to add and (b) captions that need a speaker tag — omit every caption you leave unchanged. An empty cues list is a valid answer.',
      'Sound cues: for sounds that the audio-description cues imply, as [lowercase brackets], at most 3 words, naming an audible event only (crackles, clatters, footsteps, wind) — never an object, a person or on-screen text. Each sound cue has its own id starting with "s" and its own start/end (≤ 2 s) that do not overlap a caption.',
      'Speaker tags: return the caption with its id, start and end, and its text prefixed "[Name] ", only when the speaker is off-screen or ambiguous. ≤ 42 characters per line, ≤ 2 lines.',
    ].join('\n') }],
    // The task goes after the data (with the request alone as user content Nova Lite echoed it back).
    messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\nUse the emit_sdh tool to return the SDH cues.` }] }],
    // A toolConfig makes Nova constrain its output to the tool's inputSchema, and toolChoice { tool } forces that one call:
    // https://docs.aws.amazon.com/nova/latest/userguide/concept-chapter-servicename.html · https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
    // Converse API: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
    toolConfig: { tools: [{ toolSpec: { name: 'emit_sdh', description: 'Return the SDH cues to add or tag', inputSchema: { json: SDH_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_sdh' } } },
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
  }
}

/**
 * SDH: add [sounds] and [Speaker] identification per Netflix conventions. Captions go to Nova Lite in windows of ≤ 40 (chunkCaptions),
 * one call each, metered per call; each reply holds additions only. Replies are concatenated and merged once onto the input by mergeSdh,
 * so sound ids are numbered once and sounds overlapping across a window edge are dropped. A window whose reply is unreadable adds
 * nothing (its captions stay plain) and marks the whole title degraded.
 */
export async function sdhWithNovaLite(captions: Cue[], descriptions: FitCue[], language: 'en' | 'de', send: SdhConverse = bedrockSend): Promise<{ cues: Cue[]; degraded: boolean; calls: number }> {
  const windows = chunkCaptions(captions)
  const added: ReplyCue[] = []
  let degraded = false
  for (const w of windows) {
    const r = await send(sdhRequest(w, descriptions, language))
    meter()?.bedrock(LITE(), r.usage)
    const content = r.output?.message?.content ?? []
    const reply = content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? ''
    const cues = replyCues(reply)
    if (cues) added.push(...cues)
    else { degraded = true; console.warn(`SDH: window ${w[0]!.id}–${w.at(-1)!.id} reply is not {"cues":[…]}; its captions stay plain`, (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200)) }
  }
  return { cues: mergeSdh(captions, added), degraded, calls: windows.length }
}

/** Bracketed words that make a cue a sound: Nova Lite also tags objects and actions ([rock formation], [woman holds bowl]). Extend freely. */
export const SOUND_WORDS = new Set(['crackles', 'crackling', 'crunches', 'crunching', 'clatters', 'clangs', 'clanging', 'clanks', 'slams', 'creaks', 'creaking', 'rustles', 'rustling', 'footsteps', 'wind', 'roars', 'growls', 'thuds', 'thud', 'splashes', 'splash', 'screams', 'laughs', 'laughter', 'sighs', 'gasps', 'music', 'drums', 'knocks', 'knocking', 'bangs', 'bang', 'thunder', 'explosion', 'gunshot', 'gunshots', 'bell', 'bells', 'rings', 'ringing', 'whistles', 'howls', 'barks', 'chirps', 'birdsong', 'buzzes', 'hums', 'humming', 'beeps', 'shatters', 'crashes', 'crash', 'rumbles', 'rumbling', 'hisses', 'squeaks', 'whooshes', 'groans', 'coughs', 'cries', 'sobs', 'shouts', 'whispers', 'panting', 'breathing', 'applause', 'cheering', 'silence', 'clinks', 'rattles', 'sizzles', 'drips', 'dripping', 'pours', 'swoosh', 'clicks', 'snaps', 'unsheathes', 'clash', 'clashes', 'flapping', 'flaps', 'screeches', 'screech'])

const SdhReply = z.object({ cues: z.array(z.object({ id: z.string(), start: z.coerce.number(), end: z.coerce.number(), text: z.string(), speaker: z.string().optional(), sound: z.boolean().optional() }).passthrough()) })
type ReplyCue = z.infer<typeof SdhReply>['cues'][number]

/** Nova Lite's reply (the toolUse input object, or text holding {"cues":[…]}) as SDH cues. Anything else, or zero cues, falls back to the plain captions with degraded=true. */
export function readSdhReply(reply: unknown, captions: Cue[]): { cues: Cue[]; degraded: boolean } {
  const cues = replyCues(reply)
  if (!cues?.length) {
    console.warn('SDH: Nova Lite reply is not a non-empty {"cues":[…]}; using plain captions', (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200))
    return { cues: captions.map((c) => ({ ...c, trackId: 'sdh' })), degraded: true }
  }
  return { cues: mergeSdh(captions, cues), degraded: false }
}
/** The reply's cues (the toolUse input object, or text holding {"cues":[…]}, fenced or not); undefined when it is neither. An empty list is valid. */
function replyCues(reply: unknown): ReplyCue[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') try { json = JSON.parse(stripFence(reply)) } catch { json = undefined }
  const parsed = SdhReply.safeParse(json)
  return parsed.success ? parsed.data.cues : undefined
}
/** readSdhReply's cues only. */
export const parseSdhReply = (reply: unknown, captions: Cue[]): Cue[] => readSdhReply(reply, captions).cues

/**
 * Deterministic merge: caption cues always come from the input (by id; the reply may only add a leading "[Name] " tag),
 * reply cues with unknown ids are candidate sounds, kept only if bracketed (or sound: true), ≤ 3 words, ≤ 2 s, start < end,
 * clear of every caption and earlier-accepted sound, and naming a SOUND_WORDS sound. Sorted by start, trackId 'sdh'.
 */
export function mergeSdh(captions: Cue[], reply: Array<Pick<ReplyCue, 'id' | 'start' | 'end' | 'text' | 'sound'>>): Cue[] {
  const byId = new Map<string, (typeof reply)[number]>()
  for (const c of reply) if (!byId.has(c.id)) byId.set(c.id, c)
  const out: Cue[] = captions.map((c) => {
    const tag = /^\[([A-Z][\w'.-]*(?: [A-Z][\w'.-]*){0,2})\]\s+/.exec(byId.get(c.id)?.text ?? '')?.[1]
    const isName = !!tag && !tag.toLowerCase().split(' ').some((w) => SOUND_WORDS.has(w)) // "[Wind] …" is a sound, not a speaker
    return { ...c, trackId: 'sdh', ...(isName && !c.text.startsWith('[') ? { text: `[${tag}] ${c.text}` } : {}) }
  })
  const ids = new Set(captions.map((c) => c.id))
  const sounds: Cue[] = []
  for (const c of reply) {
    if (ids.has(c.id)) continue
    const bracketed = /^\[([^\]]+)\]$/.exec(c.text.trim())
    if (!bracketed && c.sound !== true) continue
    const inner = (bracketed ? bracketed[1]! : c.text).trim().toLowerCase()
    const ws = inner.split(/\s+/)
    if (ws.length > 3 || !(c.start < c.end) || c.end - c.start > 2) continue
    if ([...captions, ...sounds].some((k) => c.start < k.end && c.end > k.start)) continue // also drops duplicates and overlapping sounds (first wins)
    if (!ws.some((w) => SOUND_WORDS.has(w.replace(/[^a-z]/g, '')))) continue
    sounds.push({ trackId: 'sdh', id: '', start: c.start, end: c.end, text: `[${inner}]`, sound: true })
  }
  sounds.sort((a, b) => a.start - b.start).forEach((s, i) => { s.id = `s${i + 1}` })
  return [...out, ...sounds].sort((a, b) => a.start - b.start)
}
/** Strips a ```json fence, any prose before it, and anything after its closing fence (also a lone trailing fence). */
export const stripFence = (t: string) => t.trim().replace(/^[\s\S]*?```(?:json)?\s*(?=[{[])/i, '').replace(/\s*```[\s\S]*$/, '')
