import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime'
import { z } from 'zod'
import type { Cue } from '@moiz0309/vega-media-kit/core'
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
 * DESC-033 (docs/decisions/0015-complete-sentences.md): complete sentences with articles and a verb, a capital letter and a full stop
 * (Gate C g11: "Man holds staff."). No example sentence: only single words are quoted.
 */
/**
 * The on-screen text rule (DESC-031, docs/decisions/0013-legible-text.md): a quote only when every word is clearly legible; text that
 * is partly hidden, cut off or blurred is described by its kind, never quoted in part or guessed. No example sentence (PR #56 review
 * M1): a sentence in the prompt is a sentence the model copies; only kinds of text and carriers are listed.
 */
export const ON_SCREEN_TEXT_RULE = 'On-screen text (titles, captions, signs, headlines, screens): quote it only when every word is clearly legible in the frames; then quote it verbatim after "Words appear:" — always this label, never "headline:" or "a sign reads". If any part of the text is hidden, cut off or blurred, do not quote any of it: say in your own words only what kind of text it is and what it is on (for example handwriting, print, a sign, a screen, a newspaper). If no text is visible, do not mention text at all. Never invent or guess text.'

/** DESC-033 (docs/decisions/0015-complete-sentences.md): Gate C g11 failed telegraphic and verbless cues. Only single words are quoted. */
export const COMPLETE_SENTENCES_RULE = 'Write complete present-tense sentences: each has a verb and its articles ("a", "the"), starts with a capital letter and ends with a full stop.'

export function describeSystemPrompt({ maxWords, knownNames, language, people = '' }: { maxWords: number; knownNames: string[]; language: 'en' | 'de'; people?: string }) {
  const known = knownNames.join(', ') || 'none'
  return [
    `You write audio description for blind and low-vision viewers. Reply in ${language === 'de' ? 'German' : 'English'}. Follow these rules exactly.`,
    '- Present tense, active voice, third person. Describe only what is visible; never motivation or emotion words: write "clenches her fists", not "is angry".',
    `- ${COMPLETE_SENTENCES_RULE}`,
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
export interface SdhEvidence {
  descriptions: readonly SdhDescription[]; audible?: (start: number, end: number) => boolean
  /** The title's length in seconds (probe.json), when known: no sound slot ends after it. */
  duration?: number
}
const toSdhDescriptions = (ds: readonly FitCue[]): SdhDescription[] => ds.map((d) => ({ start: d.startMs / 1000, end: d.endMs / 1000, text: d.text }))

/**
 * One window's request: its captions and the descriptions overlapping [start − 5 s, end + 5 s], each with its start and end (the
 * first runs sent only the start, and Nova Lite answered with zero-length "sounds" at each description's start).
 * Plain JSON text, no tool: the forced emit_sdh tool (toolConfig + toolChoice { tool }) made Nova Lite answer ModelErrorException
 * ("Model produced invalid sequence as part of ToolUse", 424) twice on Tears of Steel (4 captions) and full-length Sintel, so Rich
 * captions were left out. The narrative pass asks for plain JSON for the same reason (narrativeRequest). The reply is read by
 * replyCues (Zod) and an unreadable one is asked again once (windowReply). The data goes first and the task last: with the request
 * alone as user content Nova Lite echoed it back (docs/friction/2026-10-01-nova-lite-json-echoes-input.md).
 * Converse API: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 * Greedy decoding: temperature 0 alone still gave different replies to the same request (2026-10-14, Sintel), so topK 1 is passed
 * through additionalModelRequestFields — https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html
 */
/** The reply shape, as the last line of the SDH system prompt (replyCues reads it; an unreadable reply is asked again once). */
export const SDH_REPLY_FORMAT = 'Reply with one JSON object only, no prose, no code fence: {"cues":[{"id":"<id>","start":<seconds>,"end":<seconds>,"text":"<text>","sound":true}]} — "sound": true only on sound cues; {"cues":[]} when nothing qualifies.'

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
      SDH_REPLY_FORMAT,
    ].join('\n') }],
    // The task goes after the data (with the request alone as user content Nova Lite echoed it back).
    messages: [{ role: 'user', content: [{ text: `Input:\n${input}\n\nReply with the JSON object only.` }] }],
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
    additionalModelRequestFields: { inferenceConfig: { topK: 1 } },
  }
}

/** sha256 of the whole request (model, prompt, captions, descriptions, decoding): the cache key for one window's reply. */
export const sdhCacheKey = (input: ConverseCommandInput) => createHash('sha256').update(`sdh-v1\n${JSON.stringify(input)}`).digest('hex')

/**
 * One window's reply, from `{cacheDir}/{key}.json` when there is one (a `--from text` re-run then gives the same SDH: the first Tears
 * of Steel run degraded and its re-run added cues from identical input), else a Converse call whose readable reply is stored there.
 * Two attempts: a reply replyCues cannot read (not {"cues":[…]}: prose, an echoed request, a cut-off object) or Bedrock's
 * ModelErrorException (424) is asked again once with the same request. After a second failure the last unreadable reply is returned
 * (the caller logs it), or undefined after a ModelErrorException, so the window stays plain instead of failing the step. Any other
 * error is thrown. Every call is metered.
 */
async function windowReply(input: ConverseCommandInput, send: SdhConverse, cacheDir: string | undefined): Promise<Pick<ConverseCommandOutput, 'output' | 'usage'> | undefined> {
  const file = cacheDir && `${cacheDir}/${sdhCacheKey(input)}.json`
  if (file) {
    const hit = await readFile(file, 'utf8').then((t) => JSON.parse(t) as Pick<ConverseCommandOutput, 'output'>, () => undefined)
    if (hit?.output) return { output: hit.output, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
  }
  const ATTEMPTS = 2
  for (let attempt = 1; ; attempt++) {
    let r: Pick<ConverseCommandOutput, 'output' | 'usage'>
    try {
      r = await send(input)
    } catch (e) {
      if ((e as Error).name !== 'ModelErrorException') throw e
      console.warn(`SDH: ModelErrorException (attempt ${attempt}): ${(e as Error).message}`)
      if (attempt >= ATTEMPTS) return undefined
      continue
    }
    meter()?.bedrock(LITE(), r.usage)
    const reply = replyOf(r)
    if (replyCues(reply) === undefined) {
      if (attempt >= ATTEMPTS) return r
      console.warn(`SDH: reply is not {"cues":[…]} (attempt ${attempt}); asking again`, (typeof reply === 'string' ? reply : JSON.stringify(reply) ?? '').slice(0, 200))
      continue
    }
    if (file) {
      await mkdir(cacheDir!, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify({ output: r.output, usage: r.usage }))
      await rename(`${file}.tmp`, file)
    }
    return r
  }
}
const replyOf = (r: Pick<ConverseCommandOutput, 'output'>) => { const content = r.output?.message?.content ?? []; return content.find((c) => c.toolUse)?.toolUse?.input ?? content.find((c) => c.text)?.text ?? '' }

/**
 * SDH: add [sounds] and [Speaker] identification per Netflix conventions. Captions go to Nova Lite in windows of ≤ 40 (chunkCaptions),
 * one call each (cached per window in `opts.cacheDir`), metered per call; each reply holds additions only. Replies are concatenated and
 * merged once onto the input by mergeSdh against the evidence (the descriptions, and `opts.audible`), so sound ids are numbered once and
 * sounds overlapping across a window edge are dropped. A window whose reply is unreadable or failed twice adds nothing (its captions stay
 * plain) and marks the whole title degraded. `added` counts what the merge actually added (sound cues + speaker tags): 0 means the SDH
 * track is the plain captions — nothing qualified, which is not a failure — and 09-package does not advertise it as Rich captions.
 */
export async function sdhWithNovaLite(captions: Cue[], descriptions: FitCue[], language: 'en' | 'de', send: SdhConverse = bedrockSend, opts: { audible?: SdhEvidence['audible']; duration?: number; cacheDir?: string } = {}): Promise<{ cues: Cue[]; degraded: boolean; calls: number; added: number }> {
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
  const cues = mergeSdh(captions, added, { descriptions: toSdhDescriptions(descriptions), audible: opts.audible, duration: opts.duration })
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
/** Sounds a person's own voice or body makes: the only sounds a tag naming a person may keep ("[woman gasps]", not "[old man pours]"). */
const VOICE_SOUNDS = new Set(['gasps', 'screams', 'laughs', 'laughter', 'sighs', 'coughs', 'cries', 'sobs', 'shouts', 'whispers', 'panting', 'breathing', 'groans'])
/** Words that only qualify a person ("[old man pours]"): not a sound's source. */
const PERSON_MODIFIERS = new Set(['old', 'young', 'little', 'tall', 'short', 'small', 'big', 'elderly', 'bald', 'alte', 'alter', 'junge', 'kleine', 'kleiner'])
/**
 * A tag naming a person (an AGENT word) keeps only a voice sound (VOICE_SOUNDS); any other sound needs a source word that is neither a
 * person nor a bare modifier of one. "[old man pours]" beside "Old man pours broth." names who pours, not what sounds (PR #85 review).
 */
function personSoundOk(words: readonly string[]): boolean {
  if (!words.some((w) => AGENT.has(w))) return true
  if (words.some((w) => VOICE_SOUNDS.has(w))) return true
  return words.some((w) => !AGENT.has(w) && !PERSON_MODIFIERS.has(w) && !(SOUND_WORDS.has(w) && !SOUNDING_OBJECTS.has(w)))
}
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
/** A sound cue's length: at most MAX, at least MIN (or the cue's own length when the model gave a shorter one); a zero-length cue is read as 1 s. */
const MAX_SOUND_S = 2, MIN_SOUND_S = 0.5, ZERO_LENGTH_SOUND_S = 1
const ms = (t: number) => Math.round(t * 1000) / 1000
/** Rounded inward to the millisecond (1e-6 absorbs float noise, so 24 stays 24; + 0 turns -0 into 0), so a slot never overlaps its neighbours. */
const msUp = (t: number) => Math.ceil(t * 1000 - 1e-6) / 1000 + 0, msDown = (t: number) => Math.floor(t * 1000 + 1e-6) / 1000
/**
 * The first slot inside `within` that is clear of every obstacle (the captions and the sounds already kept), at least `min` and at
 * most MAX_SOUND_S long, and audible (when `audible` is given), or undefined. Nova Lite gives a sound the whole description's
 * start–end (full Sintel 2026-10-19: 51 of 53 cues), so the slot is cut out of it rather than the cue rejected. Starts tried, in
 * order: `within.start`, each obstacle end inside it, and every 0.1 s (for the audible check); each slot runs to MAX_SOUND_S,
 * `within.end` or the next obstacle, whichever is first. The slot is rounded inward to the millisecond.
 */
function soundSlot(within: { start: number; end: number }, min: number, obstacles: readonly Cue[], audible: SdhEvidence['audible']): { start: number; end: number } | undefined {
  if (!(within.end - within.start >= min)) return undefined
  const grid = Array.from({ length: Math.floor((within.end - within.start) / 0.1) + 1 }, (_, k) => ms(within.start + k * 0.1))
  const starts = [...new Set([within.start, ...obstacles.map((c) => c.end).filter((t) => t > within.start && t < within.end), ...grid])].sort((a, b) => a - b)
  for (const s of starts) {
    if (obstacles.some((c) => s >= c.start && s < c.end)) continue
    const e = Math.min(s + MAX_SOUND_S, within.end, ...obstacles.filter((c) => c.start > s).map((c) => c.start))
    const slot = { start: msUp(s), end: msDown(e) }
    if (slot.end > slot.start && slot.end - slot.start >= min - 1e-3 && (!audible || audible(slot.start, slot.end))) return slot
  }
  return undefined
}

const SdhReply = z.object({ cues: z.array(z.object({ id: z.string(), start: z.coerce.number(), end: z.coerce.number(), text: z.string(), speaker: z.string().optional(), sound: z.boolean().optional() }).passthrough()) })
type ReplyCue = z.infer<typeof SdhReply>['cues'][number]

/**
 * The reply's cues: text holding {"cues":[…]} — fenced or not, with prose around it (the first `{` to the last `}` is read, as the
 * narrative pass's replyEdits does) — or such an object as a toolUse input (a cached reply from before the plain-JSON request).
 * Zod-validated; undefined when it is neither. An empty list is valid.
 */
export function replyCues(reply: unknown): ReplyCue[] | undefined {
  let json: unknown = reply
  if (typeof reply === 'string') {
    const t = stripFence(reply), a = t.indexOf('{'), b = t.lastIndexOf('}')
    try { json = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : undefined } catch { json = undefined }
  }
  const parsed = SdhReply.safeParse(json)
  return parsed.success ? parsed.data.cues : undefined
}

/**
 * Deterministic merge: caption cues always come from the input (by id; the reply may only add a leading "[Name] " tag), reply cues
 * with unknown ids are candidate sounds. Nothing is kept that the evidence does not support:
 * - a speaker tag needs a real name: one said in another caption by another voice (so never "[Name]" or "[spk_1]", and not the
 *   listener: "Sintel, run!" names who is spoken to), used for one voice label only, and that voice label tagged with one name only
 *   (a conflict drops every tag involved);
 * - a sound must be bracketed (or sound: true), ≤ 3 words, name a SOUND_WORDS sound, and be grounded (groundsSound) by a description
 *   overlapping its time (± 2 s) — so "[footsteps]" beside "A man gestures" is dropped. Its timing is then trimmed, not judged
 *   (docs/decisions/0018-sdh-trim.md): it is placed in the first slot of 0.5–2 s (or its own length, if shorter) inside its span and
 *   that description's span ± 2 s that is clear of every caption and, when evidence.audible is given, over audible audio
 *   (soundSlot), and clear of the sounds already kept (a later sound takes the free time after an earlier one). The slot starts at
 *   0 or later, ends by evidence.duration when given, and is rounded inward to the millisecond. A zero-length cue is read as 1 s; a
 *   cue ending before it starts, or with no such slot, is dropped, and so is a repeat of a kept sound over the same span;
 * - a sound tag naming a person ("man", "woman": AGENT) keeps only a voice sound ("[woman gasps]"); any other needs a source that is
 *   not a person or a bare modifier ("[old man pours]" is dropped, "[broth pours]" kept).
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
  const sounds: Cue[] = [], proposed: Array<{ text: string; start: number; end: number }> = []
  for (const c of reply) {
    if (ids.has(c.id)) continue
    const bracketed = /^\[([^\]]+)\]$/.exec(c.text.trim())
    if (!bracketed && c.sound !== true) continue
    const inner = (bracketed ? bracketed[1]! : c.text).trim().toLowerCase()
    const ws = inner.split(/\s+/)
    if (ws.length > 3 || c.end < c.start) continue
    const bare = ws.map((w) => w.replace(/[^\p{L}]/gu, ''))
    if (!bare.some((w) => SOUND_WORDS.has(w))) continue
    if (!personSoundOk(bare)) continue
    const span = { start: c.start, end: c.end > c.start ? c.end : c.start + ZERO_LENGTH_SOUND_S }
    // A repeat of a kept sound over the same span is a duplicate, not a second sound.
    if (proposed.some((k) => k.text === inner && span.start < k.end && span.end > k.start)) continue
    const obstacles = [...captions, ...sounds]
    const slot = evidence.descriptions
      .filter((d) => span.start < d.end + SOUND_SLACK_S && span.end > d.start - SOUND_SLACK_S && groundsSound(inner, d.text))
      .map((d) => soundSlot({
        start: Math.max(0, span.start, d.start - SOUND_SLACK_S),
        end: Math.min(evidence.duration ?? Infinity, span.end, d.end + SOUND_SLACK_S),
      }, Math.min(MIN_SOUND_S, span.end - span.start), obstacles, evidence.audible))
      .find((s) => s !== undefined)
    if (!slot) continue
    proposed.push({ text: inner, ...span })
    sounds.push({ trackId: 'sdh', id: '', start: slot.start, end: slot.end, text: `[${inner}]`, sound: true })
  }
  sounds.sort((a, b) => a.start - b.start).forEach((s, i) => { s.id = `s${i + 1}` })
  return [...out, ...sounds].sort((a, b) => a.start - b.start)
}
/** Strips a ```json fence, any prose before it, and anything after its closing fence (also a lone trailing fence). */
export const stripFence = (t: string) => t.trim().replace(/^[\s\S]*?```(?:json)?\s*(?=[{[])/i, '').replace(/\s*```[\s\S]*$/, '')

// ─── DESC-018: scene-level edit pass (steps/05b-edit.ts; docs/decisions/0006-scene-edit-pass.md) ─────────────────────────────

/**
 * The narrative pass's model (docs/decisions/0017-narrative-pass.md): EDIT_MODEL_ID overrides; default DeepSeek v3.2 on Bedrock
 * (`deepseek.v3.2`, on-demand in us-east-1 — `aws bedrock list-foundation-models`, 2026-10-15: inferenceTypesSupported ON_DEMAND, no
 * inference profile needed), the spike's best: the most natural prose and the most cues kept (docs/spikes/narrative-pass-sintel.md).
 * https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html · https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
 */
export const DEFAULT_EDIT_MODEL_ID = 'deepseek.v3.2'
export const editModelId = () => process.env.EDIT_MODEL_ID ?? DEFAULT_EDIT_MODEL_ID
/** Asked once when the first model's call fails or its reply is unreadable: EDIT_FALLBACK_MODEL_ID, default Amazon Nova Pro ('' turns it off). */
export const DEFAULT_EDIT_FALLBACK_MODEL_ID = 'amazon.nova-pro-v1:0'
export const editFallbackModelId = () => process.env.EDIT_FALLBACK_MODEL_ID ?? DEFAULT_EDIT_FALLBACK_MODEL_ID
/** The over-budget shortening call of the edit pass stays on Nova Lite (EDIT_SHORTEN_MODEL_ID overrides), as before the narrative pass. */
export const editShortenModelId = () => process.env.EDIT_SHORTEN_MODEL_ID ?? LITE()
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
    modelId: editShortenModelId(),
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
  meter()?.bedrock(editShortenModelId(), r.usage)
  return { text: (r.output?.message?.content?.find((c) => c.text)?.text ?? '').trim(), usage: r.usage }
}

// ─── The narrative pass (05b, docs/decisions/0017-narrative-pass.md; spike docs/spikes/narrative-pass-sintel.md) ───────────────────

/** One cue as the narrative request shows it. A fixed cue is on-screen text: shown, never returned. */
export type NarrativeCueInput =
  | { cue: number; at: string; fixed: true; text: string }
  | { cue: number; at: string; extended?: true; newScene?: { place: string; returning?: true }; text: string; sources: string[]; mustStillSay: string[]; maxWords: number; mayName: string[] }
export interface NarrativeInput {
  language: 'en' | 'de'
  /** Glossary people: the look and the short reference always, the name once revealed in this window. Never the role (0012). */
  people?: readonly { look: string; short: string; name?: string }[]
  /** The last cues before this window as the viewer hears them (already rewritten), oldest first. */
  heardJustBefore?: readonly string[]
  cues: readonly NarrativeCueInput[]
}

/**
 * The system prompt (the spike's, with the scene rules of 0012 kept). No synopsis, no roles and no dialogue: "story so far" is only the
 * cues as heard, so the model has nothing to leak about what happens next or what anyone wants.
 */
export const narrativeSystemPrompt = (language: 'en' | 'de') => `You are the narrator of an audio description track for blind and low-vision viewers of a film, in ${language === 'de' ? 'German' : 'English'}. Each shot was described on its own, so the script reads as a list of separate observations. Rewrite it so it flows as ONE connected narration, the way a nature-documentary narrator carries the listener from moment to moment — while staying a strict audio description.

The input gives, per cue: its number, time, the text as now voiced, under "sources" the checked descriptions of the shots this cue covers (the only evidence of what is on screen), "mustStillSay" (facts this cue must still state; another form of the word is fine — it already leaves out the look of anyone the viewer met earlier in this scene, so refer to them as "she" or "the dragon"), "maxWords" (hard limit: count your words), "mayName" (the only names allowed in this cue), and "newScene" with the place when the cue opens a new scene ("returning" when the film comes back to a place it showed before). "people" lists who appears in the film by look. "heardJustBefore" is what the viewer heard just before these cues, already rewritten. A cue marked fixed is on-screen text: do not return it.

Continuity — do this:
- Carry referents. Once a person or creature was introduced in the previous cue or two, call them "she", "he", "it" (only when they were in one of the last two cues and no one else could be meant), or "the young woman", "the dragon" — never repeat the full look every cue. Give the look again only when a new scene starts or when two similar figures could be confused.
- Use "the" for anything already introduced, "a" the first time.
- Link cues with plain connectives: "then", "now", "as", "while", "and". Use "again", "still", "meanwhile" or "later" only when this cue's own sources say so.
- Open a new scene by saying where we are, in the words of its place, once ("Back in …" only when it is returning). Never say the place again later in the same scene, and never make a cue that is only a place.
- Vary the openings: lead with the action verb or the place, not always with the person. Mix one short sentence with a longer one.
- Warmth comes from precise, vivid verbs and concrete nouns already in the sources, and from rhythm — never from adjectives of feeling or judgement.

Audio description rules — never break these:
1. Every fact comes from this cue's sources or text, or from an earlier cue (for who someone is). Never add a person, object, action, colour, body part, place, time of day, weather or on-screen text the sources do not state.
2. Never say what anyone thinks, feels, wants, intends or remembers; no "seems", no "as if", no metaphors; never hint at what happens later; no "we see", no camera words.
3. Keep every word of mustStillSay (or a form of it). A dropped fact is never allowed.
4. At most maxWords words. Fewer is fine. If you cannot improve a cue within maxWords, return it unchanged.
5. Present tense, active voice, complete sentences with a capital letter and a full stop.
6. Names: only the ones in that cue's mayName; otherwise the look, "she" or "the dragon".
7. Keep any "Words appear: …" clause exactly as written.
8. Do not merge, split, reorder, add or drop cues.

Reply with one JSON object only, no prose, no code fence: {"cues":[{"cue":<number>,"text":"<the rewritten cue>"}]} — one entry for every cue that is not fixed, in order.`

/** One window's Converse request: plain JSON text, no forced tool (Nova Lite's ModelErrorException on forced tool use is avoided entirely). */
export function narrativeRequest(input: NarrativeInput, modelId = editModelId()): ConverseCommandInput {
  const { language, ...data } = input
  return {
    modelId,
    system: [{ text: narrativeSystemPrompt(language) }],
    messages: [{ role: 'user', content: [{ text: `Input:\n${JSON.stringify(data)}\n\nReply with the JSON object only.` }] }],
    inferenceConfig: { maxTokens: 4000, temperature: 0 },
  }
}
