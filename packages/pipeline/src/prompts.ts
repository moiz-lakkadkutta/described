import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime'
import { z } from 'zod'
import type { Cue } from '@moizp/vega-media-kit/core'
import type { Shot } from './steps/02-shots'
import type { Gap } from './steps/03-speech'
import type { FitCue, } from './steps/05-fit'
import { LATE_MS, WPS } from './steps/05-fit'
import { meter } from './cost'
import { contentWords, stem } from './contentWords'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'

/**
 * The description prompt — Netflix / Prime Video / DCMP rules, encoded. Changing this is a product decision; note it in docs/decisions.
 * Gate C (approved 2026-10-01): on-screen text only when legible, an explicit darkness rule, and no SAME rule — "nothing new"
 * is decided by parseDescription in 04-describe, which no longer shows the model the previous description.
 * DESC-010 follow-ups (2026-10-14, docs/decisions/0008-text-and-darkness.md): signs and headlines also take "Words appear:", and
 * "Darkness." only for frames where nothing can be made out. Gate C must be re-checked with this prompt.
 * DESC-029 (docs/decisions/0012-characters-and-scenes.md): with a title glossary (`people`, glossary.ts peopleAndPlaces) the prompt
 * carries "People and places in this film" — looks always, names once revealed; never roles — and the stable-descriptor rule points at
 * it; `knownNames` is then the glossary's revealed names plus the dialogue's. Without a glossary (own videos) the prompt is unchanged.
 * DESC-031 (docs/decisions/0013-legible-text.md): on-screen text is quoted only when every word is legible (ON_SCREEN_TEXT_RULE).
 */
/**
 * The on-screen text rule (DESC-031, docs/decisions/0013-legible-text.md): a quote only when every word is clearly legible; text that
 * is partly hidden, cut off or blurred is described by its kind, never quoted in part or guessed. Its example is generic on purpose:
 * no sentence from an evaluation clip.
 */
export const ON_SCREEN_TEXT_RULE = 'On-screen text (titles, captions, signs, headlines, screens): quote it only when every word is clearly legible in the frames; then quote it verbatim after "Words appear:" — always this label, never "headline:" or "a sign reads". If any part of the text is hidden, cut off or blurred, do not quote any of it: say what kind of text appears instead (e.g. "Handwritten words appear on a sign."). If no text is visible, do not mention text at all. Never invent or guess text.'

export function describeSystemPrompt({ maxWords, knownNames, language, people = '' }: { maxWords: number; knownNames: string[]; language: 'en' | 'de'; people?: string }) {
  const known = knownNames.join(', ') || 'none'
  return [
    `You write audio description for blind and low-vision viewers. Reply in ${language === 'de' ? 'German' : 'English'}. Follow these rules exactly.`,
    '- Present tense, active voice, third person. Describe only what is visible; never motivation or emotion words: write "clenches her fists", not "is angry".',
    people
      ? `- Name a character only when the list below gives the name or the dialogue has said it; otherwise refer to a listed person by their look from the list, and to anyone else by one short visible descriptor. Known names so far: ${known}.`
      : `- Do not name a character until the dialogue has named them; until then use one stable visible descriptor (e.g. "the woman in the red coat"). Known names so far: ${known}.`,
    people ? '- Precise colours (olive, burgundy). Mention scene changes ("Night. A rooftop."); when the place is one of the listed places, use its words.' : '- Precise colours (olive, burgundy). Mention scene changes ("Night. A rooftop.").',
    `- ${ON_SCREEN_TEXT_RULE}`,
    '- Write only "Darkness." when the frames are black and nothing can be made out. If anything is visible, even dimly, describe it and do not write "Darkness."; if the scene is visible but dim, say dim.',
    '- No interpretation, no film language ("the camera pans"), no "we see".',
    `- Output: one line, at most ${maxWords} words, no preamble, no quotes.`,
    ...(people ? [people] : []),
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
/** The Nova Lite model id (NOVA_LITE_MODEL_ID overrides); exported for the Gate C price check (src/eval/run.ts). */
export const LITE = () => process.env.NOVA_LITE_MODEL_ID ?? 'amazon.nova-lite-v1:0'

/** The model half of fit's shortening; fit accepts its reply only through safeShorten (no new content words, still sentences — not a noun list, not only a subject: DESC-028). */
export async function shortenWithNovaLite(text: string, maxWords: number, language: 'en' | 'de'): Promise<string> {
  const r = await client().send(new ConverseCommand({ modelId: LITE(), system: [{ text: `Shorten audio description to at most ${maxWords} words. Write one or more complete present-tense sentences, each with its verb; never a list of nouns. Remove adjectives first, then clauses. Keep the most plot-relevant fact. ${language === 'de' ? 'German.' : 'English.'} Reply with the sentences only.` }], messages: [{ role: 'user', content: [{ text }] }], inferenceConfig: { maxTokens: 80, temperature: 0 } }), { abortSignal: meter()?.signal })
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

/** A description as SDH evidence, in seconds. */
export interface SdhDescription { start: number; end: number; text: string }
/**
 * What a sound cue or speaker tag must be grounded in (mergeSdh). There is no audio-event data (Transcribe gives speech only;
 * docs/feature-requests.md P1), so a sound needs (1) a description overlapping its time that names the sound's source or action,
 * and (2) when `audible` is given, audio above the silence floor over its span (ffmpeg ebur128, 08-text). Loudness proves only that
 * something is audible, not what; the description supplies the what.
 */
export interface SdhEvidence { descriptions: readonly SdhDescription[]; audible?: (start: number, end: number) => boolean }
const toSdhDescriptions = (ds: readonly FitCue[]): SdhDescription[] => ds.map((d) => ({ start: d.startMs / 1000, end: d.endMs / 1000, text: d.text }))

/**
 * One window's request: its captions and the descriptions overlapping [start − 5 s, end + 5 s], each with its start and end (the
 * first runs sent only the start, and Nova Lite answered with zero-length "sounds" at each description's start).
 * Greedy decoding: temperature 0 alone still gave different replies to the same request (2026-10-14, Sintel), so topK 1 is passed
 * through additionalModelRequestFields — https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html
 */
export function sdhRequest(window: Cue[], descriptions: FitCue[], language: 'en' | 'de'): ConverseCommandInput {
  const from = window[0]!.start - SDH_CONTEXT_S, to = window.at(-1)!.end + SDH_CONTEXT_S
  const near = toSdhDescriptions(descriptions).filter((d) => d.start < to && d.end > from)
  const input = JSON.stringify({ language, captions: window.map(({ id, start, end, text, speaker }) => ({ id, start, end, text, speaker })), descriptions: near })
  return {
    modelId: LITE(),
    system: [{ text: [
      'You produce SDH (subtitles for the deaf and hard of hearing) from plain captions, following Netflix SDH conventions.',
      'Return only (a) sound cues to add and (b) captions that need a speaker tag — omit every caption you leave unchanged. An empty cues list is a valid answer and the right one when nothing qualifies.',
      'Sound cues: only for a sound that one description\'s action clearly makes (e.g. "A fire burns" → [fire crackling], "She slams the door" → [door slams]). Write it as [lowercase brackets], at most 3 words: the sound\'s source, a word from that description, then the sound ("crackling", "slams", "footsteps"). Never a sight ("glows", "holds", "darkness"), an object, a person or on-screen text, and never a sound no description shows. Each sound cue has its own id starting with "s", sound: true, and a start/end 0.5–2 s long inside that description\'s start–end and not overlapping a caption.',
      'Speaker tags: "speaker" values like spk_0 are anonymous voice labels, never names. Tag a caption only when the speaker is off-screen or ambiguous and their name is spoken in the captions: return it with its id, start and end, and its text prefixed "[Name] " with that real name. Never use a voice label or a placeholder as the name.',
    ].join('\n') }],
    // The task goes after the data (with the request alone as user content Nova Lite echoed it back).
    messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\nUse the emit_sdh tool to return the SDH cues.` }] }],
    // A toolConfig makes Nova constrain its output to the tool's inputSchema, and toolChoice { tool } forces that one call:
    // https://docs.aws.amazon.com/nova/latest/userguide/concept-chapter-servicename.html · https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
    // Converse API: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
    toolConfig: { tools: [{ toolSpec: { name: 'emit_sdh', description: 'Return the SDH cues to add or tag', inputSchema: { json: SDH_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_sdh' } } },
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
    additionalModelRequestFields: { inferenceConfig: { topK: 1 } },
  }
}

/** sha256 of the whole request (model, prompt, captions, descriptions, decoding): the cache key for one window's reply. */
export const sdhCacheKey = (input: ConverseCommandInput) => createHash('sha256').update(`sdh-v1\n${JSON.stringify(input)}`).digest('hex')

/**
 * One window's reply, from `{cacheDir}/{key}.json` when there is one (a `--from text` re-run then gives the same SDH: the first Tears
 * of Steel run degraded and its re-run added cues from identical input), else a Converse call whose reply is stored there.
 * Bedrock's ModelErrorException ("Model produced invalid sequence as part of ToolUse", 424) is retried once; a second failure returns
 * undefined, so the window stays plain instead of failing the step. Any other error is thrown.
 */
async function windowReply(input: ConverseCommandInput, send: SdhConverse, cacheDir: string | undefined): Promise<Pick<ConverseCommandOutput, 'output' | 'usage'> | undefined> {
  const file = cacheDir && `${cacheDir}/${sdhCacheKey(input)}.json`
  if (file) {
    const hit = await readFile(file, 'utf8').then((t) => JSON.parse(t) as Pick<ConverseCommandOutput, 'output'>, () => undefined)
    if (hit?.output) return { output: hit.output, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await send(input)
      meter()?.bedrock(LITE(), r.usage)
      if (file && replyCues(replyOf(r)) !== undefined) {
        await mkdir(cacheDir!, { recursive: true })
        await writeFile(`${file}.tmp`, JSON.stringify({ output: r.output, usage: r.usage }))
        await rename(`${file}.tmp`, file)
      }
      return r
    } catch (e) {
      if ((e as Error).name !== 'ModelErrorException') throw e
      console.warn(`SDH: ModelErrorException (attempt ${attempt}): ${(e as Error).message}`)
      if (attempt >= 2) return undefined
    }
  }
}
const replyOf = (r: Pick<ConverseCommandOutput, 'output'>) => { const content = r.output?.message?.content ?? []; return content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? '' }

/**
 * SDH: add [sounds] and [Speaker] identification per Netflix conventions. Captions go to Nova Lite in windows of ≤ 40 (chunkCaptions),
 * one call each (cached per window in `opts.cacheDir`), metered per call; each reply holds additions only. Replies are concatenated and
 * merged once onto the input by mergeSdh against the evidence (the descriptions, and `opts.audible`), so sound ids are numbered once and
 * sounds overlapping across a window edge are dropped. A window whose reply is unreadable or failed twice adds nothing (its captions stay
 * plain) and marks the whole title degraded. `added` counts what the merge actually added (sound cues + speaker tags): 0 means the SDH
 * track is the plain captions, which 08-text does not advertise as Rich captions.
 */
export async function sdhWithNovaLite(captions: Cue[], descriptions: FitCue[], language: 'en' | 'de', send: SdhConverse = bedrockSend, opts: { audible?: SdhEvidence['audible']; cacheDir?: string } = {}): Promise<{ cues: Cue[]; degraded: boolean; calls: number; added: number }> {
  const windows = chunkCaptions(captions)
  const added: ReplyCue[] = []
  let degraded = false
  for (const w of windows) {
    const r = await windowReply(sdhRequest(w, descriptions, language), send, opts.cacheDir)
    const reply = r ? replyOf(r) : ''
    const cues = r ? replyCues(reply) : undefined
    if (cues) added.push(...cues)
    else { degraded = true; console.warn(`SDH: window ${w[0]!.id}–${w.at(-1)!.id} reply is not {"cues":[…]}; its captions stay plain`, (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200)) }
  }
  const cues = mergeSdh(captions, added, { descriptions: toSdhDescriptions(descriptions), audible: opts.audible })
  const text = new Map(captions.map((c) => [c.id, c.text]))
  const count = cues.filter((c) => c.sound || (text.has(c.id) && text.get(c.id) !== c.text)).length
  return { cues, degraded, calls: windows.length, added: count }
}

/** Bracketed words that make a cue a sound: Nova Lite also tags objects and actions ([rock formation], [woman holds bowl]). Extend freely. */
export const SOUND_WORDS = new Set(['crackles', 'crackling', 'crunches', 'crunching', 'clatters', 'clangs', 'clanging', 'clanks', 'slams', 'creaks', 'creaking', 'rustles', 'rustling', 'footsteps', 'wind', 'roars', 'growls', 'thuds', 'thud', 'splashes', 'splash', 'screams', 'laughs', 'laughter', 'sighs', 'gasps', 'music', 'drums', 'knocks', 'knocking', 'bangs', 'bang', 'thunder', 'explosion', 'gunshot', 'gunshots', 'bell', 'bells', 'rings', 'ringing', 'whistles', 'howls', 'barks', 'chirps', 'birdsong', 'buzzes', 'hums', 'humming', 'beeps', 'shatters', 'crashes', 'crash', 'rumbles', 'rumbling', 'hisses', 'squeaks', 'whooshes', 'groans', 'coughs', 'cries', 'sobs', 'shouts', 'whispers', 'panting', 'breathing', 'applause', 'cheering', 'silence', 'clinks', 'rattles', 'sizzles', 'drips', 'dripping', 'pours', 'pouring', 'swoosh', 'clicks', 'snaps', 'unsheathes', 'clash', 'clashes', 'flapping', 'flaps', 'screeches', 'screech'])
/** Words a model put in a speaker tag that are not a name (Tears of Steel 2026-10-14 published "[Name] This is pretty freaky."). */
const NOT_A_NAME = /^(name|speaker|unknown|voice|person|man|woman|narrator|spk_?\d*)$/i
/** Who makes a sound is not evidence of it: "[man screams]" beside "A man gestures" shares only the agent (PR #38 review). */
const AGENT = new Set(['man', 'woman', 'girl', 'boy', 'person', 'people', 'figure', 'robot', 'he', 'she', 'they', 'mann', 'frau', 'mädchen', 'junge'])
/**
 * Sounds a described source or action makes though the description does not name the sound ("A fire burns" → [fire crackling], the
 * prompt's own example; "walks" → [footsteps]). Keys and values are words, compared by stem. Only sources and actions that always
 * make that sound: a dog may sleep, a bell may hang, water "runs" and stone "steps" are not feet (PR #38 review). Anything else needs
 * the sound word itself in the description ("A dog barks"). English only, like SOUND_WORDS.
 */
const SOURCE_SOUNDS: Record<string, string[]> = {
  fire: ['crackling', 'crackles'], flame: ['crackling', 'crackles'], campfire: ['crackling', 'crackles'],
  lightning: ['thunder', 'rumbles', 'rumbling'],
  walks: ['footsteps'], climbs: ['footsteps'],
}
const SOURCE_SOUND_STEMS = new Map(Object.entries(SOURCE_SOUNDS).map(([k, v]) => [stem(k), new Set(v.map(stem))]))
/** SOUND_WORDS that name an object, not its sound: "A bell hangs in the tower" shows a bell, not a ring. In grounding they are sources. */
const SOUNDING_OBJECTS = new Set(['bell', 'bells', 'drums'])
/**
 * A description grounds a sound tag when every other word of the tag (its source: "door", "broth") is in the description, agents
 * aside, and one of its sound words is either in the description too ("slams", "pours", "explosion") or a known sound of a described
 * source or action (SOURCE_SOUNDS). So "[tent rustles]" beside "The tent glows" fails: the tent is there, the rustle is not.
 */
export function groundsSound(tag: string, description: string): boolean {
  const ws = contentWords(tag).filter((w) => !AGENT.has(w))
  const isSound = (w: string) => SOUND_WORDS.has(w) && !SOUNDING_OBJECTS.has(w)
  const sound = ws.filter(isSound).map(stem), source = ws.filter((w) => !isSound(w)).map(stem)
  const d = new Set(contentWords(description).map(stem))
  if (!sound.length || !source.every((w) => d.has(w))) return false
  return sound.some((w) => d.has(w) || [...d].some((k) => SOURCE_SOUND_STEMS.get(k)?.has(w)))
}
/** Seconds a sound may sit outside the description that grounds it (fit places a description in the nearest gap, not on the action). */
const SOUND_SLACK_S = 2

const SdhReply = z.object({ cues: z.array(z.object({ id: z.string(), start: z.coerce.number(), end: z.coerce.number(), text: z.string(), speaker: z.string().optional(), sound: z.boolean().optional() }).passthrough()) })
type ReplyCue = z.infer<typeof SdhReply>['cues'][number]

/** The reply's cues (the toolUse input object, or text holding {"cues":[…]}, fenced or not); undefined when it is neither. An empty list is valid. */
export function replyCues(reply: unknown): ReplyCue[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') try { json = JSON.parse(stripFence(reply)) } catch { json = undefined }
  const parsed = SdhReply.safeParse(json)
  return parsed.success ? parsed.data.cues : undefined
}

/**
 * Deterministic merge: caption cues always come from the input (by id; the reply may only add a leading "[Name] " tag), reply cues
 * with unknown ids are candidate sounds. Nothing is kept that the evidence does not support:
 * - a speaker tag needs a real name: one said in another caption by another voice (so never "[Name]" or "[spk_1]", and not the
 *   listener: "Sintel, run!" names who is spoken to), used for one voice label only, and that voice label tagged with one name only
 *   (a conflict drops every tag involved);
 * - a sound must be bracketed (or sound: true), ≤ 3 words, 0 < length ≤ 2 s, clear of every caption and earlier-accepted sound, name a
 *   SOUND_WORDS sound, be grounded (groundsSound) by a description overlapping its time (± 2 s) — so "[footsteps]" beside "A man
 *   gestures" is dropped — and, when evidence.audible is given, be over audible audio.
 * Sorted by start, trackId 'sdh'.
 */
export function mergeSdh(captions: Cue[], reply: Array<Pick<ReplyCue, 'id' | 'start' | 'end' | 'text' | 'sound'>>, evidence: SdhEvidence): Cue[] {
  const byId = new Map<string, (typeof reply)[number]>()
  for (const c of reply) if (!byId.has(c.id)) byId.set(c.id, c)
  const said = captions.map((c) => ({ c, words: new Set(contentWords(c.text)) }))
  const tags = new Map<string, string>() // caption id → name
  for (const c of captions) {
    const tag = /^\[(\p{Lu}[\p{L}'.-]*(?: \p{Lu}[\p{L}'.-]*){0,2})\]\s+/u.exec(byId.get(c.id)?.text ?? '')?.[1]
    if (!tag || c.text.startsWith('[')) continue
    const ws = contentWords(tag) // "Dr. Ford" → dr, ford: the same words as "Dr. Ford is late."
    if (!ws.length || ws.some((w) => SOUND_WORDS.has(w))) continue // "[Wind] …" is a sound, not a speaker
    if (ws.some((w) => NOT_A_NAME.test(w))) continue
    // Said by someone else: another caption, and not one diarized as the same voice.
    if (!said.some(({ c: k, words }) => k.id !== c.id && !(k.speaker && c.speaker && k.speaker === c.speaker) && ws.every((w) => words.has(w)))) continue
    tags.set(c.id, tag)
  }
  // Consistency is checked on diarized captions only: a caption without a voice label cannot contradict another.
  const voice = new Map(captions.map((c) => [c.id, c.speaker]))
  const namesOf = new Map<string, Set<string>>(), voicesOf = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v)
  for (const [id, name] of tags) { const v = voice.get(id); if (v) { add(namesOf, v, name); add(voicesOf, name, v) } }
  const consistent = (id: string) => { const v = voice.get(id); return !v || (namesOf.get(v)!.size === 1 && voicesOf.get(tags.get(id)!)!.size === 1) }
  const out: Cue[] = captions.map((c) => ({ ...c, trackId: 'sdh', ...(tags.has(c.id) && consistent(c.id) ? { text: `[${tags.get(c.id)}] ${c.text}` } : {}) }))
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
    const grounded = evidence.descriptions.some((d) => c.start < d.end + SOUND_SLACK_S && c.end > d.start - SOUND_SLACK_S && groundsSound(inner, d.text))
    if (!grounded || (evidence.audible && !evidence.audible(c.start, c.end))) continue
    sounds.push({ trackId: 'sdh', id: '', start: c.start, end: c.end, text: `[${inner}]`, sound: true })
  }
  sounds.sort((a, b) => a.start - b.start).forEach((s, i) => { s.id = `s${i + 1}` })
  return [...out, ...sounds].sort((a, b) => a.start - b.start)
}
/** Strips a ```json fence, any prose before it, and anything after its closing fence (also a lone trailing fence). */
export const stripFence = (t: string) => t.trim().replace(/^[\s\S]*?```(?:json)?\s*(?=[{[])/i, '').replace(/\s*```[\s\S]*$/, '')

// ─── DESC-018: scene-level edit pass (steps/05b-edit.ts; docs/decisions/0006-scene-edit-pass.md) ─────────────────────────────

/** EDIT_MODEL_ID overrides; default Nova Lite (the probe winner: forced tool, no invented facts, ≈ $0.0002 per window). */
export const editModelId = () => process.env.EDIT_MODEL_ID ?? LITE()
/** The Converse call the edit pass makes; injectable so tests replay recorded replies. */
export type EditConverse = (input: ConverseCommandInput) => Promise<Pick<ConverseCommandOutput, 'output' | 'usage'>>
export const bedrockEditSend: EditConverse = (i) => client().send(new ConverseCommand(i), { abortSignal: meter()?.signal })

/**
 * The shortening request for an over-budget edit: maxWords, keeping every fact of `keep` (the cue's original text). The words the guard
 * requires (`mustSay`, 05b-edit factWords) come first: fit's shortener keeps "the most plot-relevant fact" and dropped the cue's own
 * action from a fold (probe round 6). No "(count them)": on sintel-90-210 Nova Lite's whole reply to that was "(9 words)" (3 of 3
 * calls); the edit step also strips such an annotation (cleanShortening) and treats a reply that is only one as no reply.
 */
export function shortenEditRequest(text: string, maxWords: number, keep: string, mustSay: readonly string[], language: 'en' | 'de'): ConverseCommandInput {
  return {
    modelId: editModelId(),
    system: [{ text: [
      `Shorten an audio description line. The shortened line must still contain ${mustSay.length ? `these words (another form of the same word is fine): ${mustSay.join(', ')} — and ` : ''}every fact of this line: "${keep}". You may reword it; never drop a fact from it. Compress or drop the other part first.`,
      `At most ${maxWords} words. Present tense, no new facts. ${language === 'de' ? 'German.' : 'English.'}`,
      'Reply with the shortened line only: never a word count, a note, quotes or anything else.',
    ].join('\n') }],
    messages: [{ role: 'user', content: [{ text }] }],
    inferenceConfig: { maxTokens: 80, temperature: 0 },
  }
}

/** One Nova Lite call for shortenEditRequest; the edit step cleans the reply and re-runs its guards on it, and adds the usage to edit.json. */
export async function shortenEditWithNovaLite(text: string, maxWords: number, keep: string, mustSay: readonly string[], language: 'en' | 'de'): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const r = await client().send(new ConverseCommand(shortenEditRequest(text, maxWords, keep, mustSay, language)), { abortSignal: meter()?.signal })
  meter()?.bedrock(editModelId(), r.usage)
  return { text: (r.output?.message?.content?.find((c) => c.text)?.text ?? '').trim(), usage: r.usage }
}

/**
 * DESC-029 (docs/decisions/0012-characters-and-scenes.md): the rules for a window that is one scene, and for a title with a glossary.
 * Voice: a describer guiding a listener through the story — connective, story-aware, in the film's tone (Netflix AD style guide §1.2,
 * §5.2; Walczak & Fryer 2017 on creative AD) — inside the guardrails: nothing not visible, no thoughts, no foreshadowing (§1.4, DCMP).
 */
export function sceneRules(scene: EditInput['scene'], people: EditInput['people']): string[] {
  const out: string[] = []
  if (scene) {
    out.push(scene.placeAlreadySaid
      ? `8. These cues continue one scene, set in ${JSON.stringify(scene.setting)}; an earlier cue already said where it is. Do not say the place again.`
      : `8. These cues are one scene, set in ${JSON.stringify(scene.setting)}${scene.looks ? ` (${scene.looks})` : ''}. If no cue says where we are, say it briefly at the start of the first cue that carries action, in the words of the setting, when the words fit; ${scene.returning ? `this scene returns to an earlier place, so it may open "Back in ${scene.setting.replace(/^(?:the|a|an)\s+/i, 'the ')}". ` : ''}Never say the place twice in the scene.`)
  }
  if (people?.length) out.push('9. People: refer to a person listed under people by their look. Use a name only in a cue whose mayName lists it; the first time, say the look and the name ("the bald old man, Proog"). Never name anyone else, never use a name before mayName allows it, and never give a name to a figure whose description does not match that person\'s look.')
  if (scene || people?.length) out.push(`${people?.length ? 10 : 9}. Voice: guide the listener through the story as a film's describer would: connect the cues ("Back in the lab, the man…", "then"), choose what matters to the story, and match the film's tone. Never say what anyone thinks, wants or feels, never hint at what happens later, and say nothing that is not visible in the cues and their missedJustBefore.`)
  return out
}

/** JSON Schema for the forced emit_edits tool's input (Nova: top level object with type, properties, required only). */
export const EDIT_TOOL_SCHEMA = {
  type: 'object', required: ['edits'],
  properties: { edits: { type: 'array', description: 'Revised voiced cues only; omit every cue you leave unchanged.', items: { type: 'object', required: ['cue', 'text'], properties: { cue: { type: 'integer', description: 'The cue number from the input' }, text: { type: 'string', description: 'The whole revised cue text, one line' } } } } },
}

/** One cue as the edit step hands it to the request: its index in cues.json, budget, whether it is a frozen on-screen text cue, and the dropped descriptions just before it. */
export interface EditCueInput { i: number; startMs: number; text: string; wordCount: number; budget: number; extended: boolean; onScreenText: boolean; missed: string[]; /** the cue's facts the guard requires the edit to keep (05b-edit factWords) */ mustSay?: string[]; /** DESC-029: the names this cue may use (glossary names revealed by its start, and names the dialogue has said) */ mayName?: string[] }
export interface EditInput {
  language: 'en' | 'de'
  cues: readonly EditCueInput[]
  dialogue: readonly { start: number; end: number; speaker?: string; text: string }[]
  /** The last cue of the previous window, already revised: what the viewer heard just before this window. */
  heard?: string
  /** DESC-029: the scene these cues belong to (04c-scenes): its place, the glossary look of that place, whether it returns to an earlier place, and whether an earlier cue already said where it is. */
  scene?: { setting: string; looks?: string; returning: boolean; placeAlreadySaid: boolean }
  /** DESC-029: the title's people (glossary): the look always; the name once revealed (namedFrom: segment seconds). Never the role (0012). */
  people?: readonly { look: string; name?: string; namedFrom?: number }[]
}

/**
 * One window's request: the system prompt states the rules; the data goes first in the user turn and the task last (as sdhRequest
 * found Nova Lite needs). `tool` forces emit_edits (toolChoice); `json` asks for the same object as plain text — the edit step's retry
 * when Nova's forced tool call fails.
 * The cues are listed as heard, each with its word count, how many words may be added, and — under missedJustBefore — the descriptions
 * of the shots dropped between the previous cue and this one. Dropped shots are shown only under the cue that may absorb them, so "fold
 * into the next cue" has one reading (round 4: a flat timeline had Nova fold the shot after a cue into it); a voiced shot's full
 * description is left out, because shown next to its shortened cue both models "restored" it (round 2). An on-screen text cue
 * (DESC-017) is listed as fixed, with no room and no dropped shots: the viewer hears it, the model may not touch it.
 * https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html · https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolChoice.html
 */
export function editRequest({ language, cues, dialogue, heard, scene, people }: EditInput, mode: 'tool' | 'json' = 'tool'): ConverseCommandInput {
  const s = (ms: number) => Math.round(ms / 100) / 10
  const items = cues.map((c) => c.onScreenText
    ? { cue: c.i, start: s(c.startMs), text: c.text, onScreenText: true, fixed: true }
    : { cue: c.i, start: s(c.startMs), ...(c.extended ? { extended: true } : {}), ...(c.missed.length ? { missedJustBefore: c.missed } : {}), text: c.text, ...(c.mustSay?.length ? { mustStillSay: c.mustSay } : {}), ...(c.mayName ? { mayName: c.mayName } : {}), words: c.wordCount, wordsYouMayAdd: c.budget - c.wordCount })
  const input = JSON.stringify({ language, ...(heard ? { heardJustBefore: heard } : {}), ...(scene ? { scene } : {}), ...(people?.length ? { people } : {}), cues: items, dialogue })
  return {
    modelId: editModelId(),
    system: [{ text: [
      `You edit an audio description script for blind and low-vision viewers, in ${language === 'de' ? 'German' : 'English'}. Each shot was described on its own, then the cues were shortened and placed in the pauses of the dialogue. The viewer hears only the cues, in order. Your job is continuity between cues.`,
      'The input lists the cues in order: the text as the viewer hears it, under mustStillSay the words of that cue your text must still contain, how many words you may add (the pause allows no more), and under missedJustBefore the descriptions of shots that were dropped between the previous cue and this one (never heard: there was no pause), plus the dialogue. A cue marked fixed is on-screen text read out as written: never return it.',
      mode === 'tool'
        ? 'Return, through the emit_edits tool, the revised text of voiced cues only, and only the cues you change. Returning no edits is a valid answer.'
        : 'Reply with one JSON object only, exactly {"edits":[{"cue":<number>,"text":"<revised cue>"}]} — no prose, no code fence — holding the revised text of voiced cues only, and only the cues you change. {"edits":[]} is a valid answer.',
      'Rules, in order of importance:',
      '0. A revised cue must still contain every word of its mustStillSay (another form of the same word is fine, e.g. pour → pours). A fold adds the dropped shot to the cue; it never replaces the cue\'s own action. If that does not fit, leave the cue unchanged.',
      '1. Facts come only from the cues and their missedJustBefore descriptions. Never add a person, object, action, colour, place or on-screen text that is not stated there. No interpretation, no emotion or motivation.',
      '2. wordsYouMayAdd is exact: count the words of your text (whitespace-separated); a cue with wordsYouMayAdd 0 may only be reworded or shortened. If a change does not fit, leave the cue unchanged.',
      '3. When a cue\'s missedJustBefore states something the viewer needs (a new person, an object, an action), fold it into THAT cue, before the cue\'s own action, when the words fit: e.g. missedJustBefore ["Man stirs pot over fire."] and text "Old man pours broth." (wordsYouMayAdd 7) → "The man stirs a pot over the fire, then pours broth." Never fold anything into another cue.',
      '4. Remove only what the previous cue already told the viewer (a repeated place, a repeated descriptor); keep every other fact of the cue word for word — dropping a fact is never allowed. Say "the" for a person or thing an earlier cue introduced and "a" the first time; use "the same …" only when it helps the viewer follow.',
      '5. Keep the house style: present tense, active voice, third person, short sentences, no film language ("the camera"), no "we see". One line per cue.',
      '6. Keep any "Words appear: …" clause exactly as written, and never add one.',
      '7. Do not add, remove, merge, split or reorder cues, and do not mention timing; it is fixed.',
      ...sceneRules(scene, people),
    ].join('\n') }],
    messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\n${mode === 'tool' ? 'Use the emit_edits tool to return the revised cues.' : 'Reply with the JSON object {"edits":[…]} only.'}` }] }],
    ...(mode === 'tool' ? { toolConfig: { tools: [{ toolSpec: { name: 'emit_edits', description: 'Return the revised text of the voiced cues you change', inputSchema: { json: EDIT_TOOL_SCHEMA } } }], toolChoice: { tool: { name: 'emit_edits' } } } } : {}),
    inferenceConfig: { maxTokens: 2000, temperature: 0 },
  }
}
