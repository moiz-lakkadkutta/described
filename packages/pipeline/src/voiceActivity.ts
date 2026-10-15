import { execa } from 'execa'
import type { Gap, Word } from './steps/03-speech'

/**
 * Speech that Transcribe missed (decision 0014). Transcribe gives word timings only for what it recognised; a shout under
 * gunfire ("Come on!", Tears of Steel 8:13) has no words, so gapsFromWords left a gap over it and fit placed a cue there.
 * This finds loud, centre-panned sound in the voice band inside each gap and calls it unlabelled speech; the gap is split
 * around it with the same 200 ms margin. Deterministic, local (ffmpeg), no paid service.
 *
 * Method, per 50 ms frame of the mezzanine's stereo mix (always stereo AAC, 01-probe):
 * - mid = (L + R) / 2 and side = (L − R) / 2, each band-passed to 300–3400 Hz (two 2-pole high-pass and low-pass stages);
 *   film dialogue is mixed to the centre, so it is in mid and cancels in side; music and most effects are spread wide;
 * - a frame is voiced when its mid level is ≥ `aboveMedianDb` over the gap's own median mid level (the gap's typical level,
 *   so a loud action scene raises the bar) **and** mid is ≥ `centreDb` over side (the sound is centred);
 * - voiced runs are joined across holes ≤ `bridgeMs` and kept when ≥ `minSpeechMs`; short knocks and impacts stay out.
 * Measured on four recorded clips (decision 0014): both Transcribe misses on Tears of Steel 6:30–8:30 are caught; 0–10 % of gap time is lost.
 * - a voiced frame is also ≥ an absolute floor: the median level of Transcribe's word frames − 20 dB (−60 dBFS with no words), so
 *   a faint sound in a near-silent gap is not speech;
 * - a mono source (L = R; the clip's median mid − side above 30 dB) is not checked: every loud sound would be centred.
 */
export interface VadOptions { sampleRate: number; lowHz: number; highHz: number; frameMs: number; centreDb: number; aboveMedianDb: number; minSpeechMs: number; bridgeMs: number; floorBelowDialogueDb: number; floorNoWordsDb: number; monoCentreDb: number }
export const VAD: Readonly<VadOptions> = {
  sampleRate: 8000,
  lowHz: 300,
  highHz: 3400,
  frameMs: 50,
  /** mid over side, dB: 8 dB is mid power ≥ 6.3 × side power. */
  centreDb: 8,
  /** mid over the gap's median mid level, dB. */
  aboveMedianDb: 6,
  /** A segment shorter than this (after bridging) is not speech for this purpose: impacts, knocks, a single squeak. */
  minSpeechMs: 500,
  /** Voiced frames separated by at most this much unvoiced time are one segment. */
  bridgeMs: 50,
  /** Absolute floor: a voiced frame is also ≥ the median mid level of Transcribe's word frames − this (a near-silent gap has no bar). */
  floorBelowDialogueDb: 20,
  /** The floor when Transcribe found no words. */
  floorNoWordsDb: -60,
  /** A clip whose median mid − side is above this is mono (L = R after 01-probe's -ac 2): the centre test means nothing, so no check. */
  monoCentreDb: 30,
}
export interface Segment { startMs: number; endMs: number }
/** Band-passed mid and side level per frame, dBFS (−120 for digital silence). */
export interface Levels { frameMs: number; midDb: Float64Array; sideDb: Float64Array }

/**
 * `ffmpeg … -af pan=…,highpass,highpass,lowpass,lowpass -ar 8000 -f f32le pipe:1`: two channels (mid, side) of 32-bit float PCM.
 * pan https://ffmpeg.org/ffmpeg-filters.html#pan · highpass/lowpass https://ffmpeg.org/ffmpeg-filters.html#highpass
 */
export function vadArgs(mezz: string, o: VadOptions = VAD): string[] {
  const band = `highpass=f=${o.lowHz},highpass=f=${o.lowHz},lowpass=f=${o.highHz},lowpass=f=${o.highHz}`
  return ['-v', 'error', '-nostdin', '-i', mezz, '-vn', '-af', `pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0-0.5*c1,${band}`, '-ar', String(o.sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1']
}

const toDb = (meanSquare: number) => (meanSquare > 1e-12 ? 10 * Math.log10(meanSquare) : -120)

/** Accumulates interleaved stereo f32le PCM (any chunking) into per-frame mid/side levels. */
export class LevelMeter {
  private rest = Buffer.alloc(0)
  private n = 0
  private sumMid = 0
  private sumSide = 0
  private readonly perFrame: number
  private readonly mid: number[] = []
  private readonly side: number[] = []
  constructor(private readonly sampleRate = VAD.sampleRate, private readonly frameMs = VAD.frameMs) { this.perFrame = Math.round((sampleRate * frameMs) / 1000) }
  push(chunk: Buffer) {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk
    const whole = buf.length - (buf.length % 8)
    for (let o = 0; o < whole; o += 8) {
      const m = buf.readFloatLE(o)
      const s = buf.readFloatLE(o + 4)
      this.sumMid += m * m
      this.sumSide += s * s
      if (++this.n === this.perFrame) this.flush()
    }
    this.rest = Buffer.from(buf.subarray(whole))
  }
  private flush() {
    this.mid.push(toDb(this.sumMid / this.n))
    this.side.push(toDb(this.sumSide / this.n))
    this.n = 0; this.sumMid = 0; this.sumSide = 0
  }
  /** A trailing partial frame is dropped: it is shorter than any segment that counts. */
  levels(): Levels { return { frameMs: this.frameMs, midDb: Float64Array.from(this.mid), sideDb: Float64Array.from(this.side) } }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2
}

/** Unlabelled speech inside one gap: centred voice-band sound well above the gap's median level, ≥ minSpeechMs after bridging. */
export function voicedSegments(levels: Levels, gap: Gap, o: VadOptions = VAD, floorDb = -Infinity): Segment[] {
  const f = levels.frameMs
  const i0 = Math.ceil(gap.startMs / f)
  const i1 = Math.min(levels.midDb.length, Math.floor(gap.endMs / f))
  if ((i1 - i0) * f < o.minSpeechMs) return []
  const mid = levels.midDb.subarray(i0, i1)
  const side = levels.sideDb.subarray(i0, i1)
  const bar = median(Array.from(mid)) + o.aboveMedianDb
  const runs: Array<[number, number]> = []
  for (let i = i0; i < i1; i++) {
    const voiced = mid[i - i0]! >= bar && mid[i - i0]! >= floorDb && mid[i - i0]! - side[i - i0]! >= o.centreDb
    if (!voiced) continue
    const last = runs.at(-1)
    if (last && (i - last[1]) * f <= o.bridgeMs) last[1] = i + 1
    else runs.push([i, i + 1])
  }
  return runs.filter(([a, b]) => (b - a) * f >= o.minSpeechMs).map(([a, b]) => ({ startMs: a * f, endMs: b * f }))
}

/** Splits gaps around unlabelled speech with the same margin as around words (gapsFromWords); pieces under minGapMs are dropped. */
export function splitGaps(gaps: Gap[], speech: Segment[], minGapMs = 1200, marginMs = 200): Gap[] {
  const sorted = [...speech].sort((a, b) => a.startMs - b.startMs)
  const out: Gap[] = []
  for (const g of gaps) {
    let cursor = g.startMs
    for (const s of sorted) {
      if (s.endMs + marginMs <= cursor || s.startMs - marginMs >= g.endMs) continue
      if (s.startMs - marginMs - cursor >= minGapMs) out.push({ startMs: cursor, endMs: s.startMs - marginMs })
      cursor = Math.max(cursor, s.endMs + marginMs)
    }
    if (g.endMs - cursor >= minGapMs) out.push({ startMs: cursor, endMs: g.endMs })
  }
  return out
}

/** Total length of a set of gaps, ms. */
export const gapMs = (gaps: Gap[]) => gaps.reduce((t, g) => t + g.endMs - g.startMs, 0)

/** Streams the mezzanine's band-passed mid/side through ffmpeg into per-frame levels (a full-length film is ~0.2 MB of levels). */
export async function measureLevels(mezz: string, signal?: AbortSignal, o: VadOptions = VAD): Promise<Levels> {
  const meter = new LevelMeter(o.sampleRate, o.frameMs)
  const p = execa('ffmpeg', vadArgs(mezz, o), { encoding: 'buffer', buffer: { stdout: false }, cancelSignal: signal })
  p.stdout.on('data', (c: Buffer) => meter.push(c))
  await p
  return meter.levels()
}

/** The absolute floor: median mid level over the frames inside Transcribe's words − floorBelowDialogueDb; floorNoWordsDb without words. */
export function dialogueFloorDb(levels: Levels, words: Pick<Word, 'start' | 'end'>[], o: VadOptions = VAD): number {
  const f = levels.frameMs
  const xs: number[] = []
  for (const w of words) for (let i = Math.ceil((w.start * 1000) / f); i < Math.min(levels.midDb.length, Math.floor((w.end * 1000) / f)); i++) xs.push(levels.midDb[i]!)
  return xs.length ? median(xs) - o.floorBelowDialogueDb : o.floorNoWordsDb
}

/** Median of mid − side over the clip's audible frames (mid > −100 dBFS); 0 when nothing is audible. */
export function centreMedianDb(levels: Levels): number {
  const xs: number[] = []
  for (let i = 0; i < levels.midDb.length; i++) if (levels.midDb[i]! > -100) xs.push(levels.midDb[i]! - levels.sideDb[i]!)
  return xs.length ? median(xs) : 0
}

export interface VadResult {
  /** L = R: not checked (speech is then empty). */
  mono: boolean
  centreMedianDb: number
  floorDb: number
  speech: Segment[]
}

/** Pure: unlabelled speech in every gap, in time order, with the clip-level checks (mono, floor) that decided it. */
export function findUnlabelledSpeech(levels: Levels, gaps: Gap[], words: Pick<Word, 'start' | 'end'>[], o: VadOptions = VAD): VadResult {
  const centre = centreMedianDb(levels)
  const floorDb = dialogueFloorDb(levels, words, o)
  const mono = centre > o.monoCentreDb
  return { mono, centreMedianDb: Math.round(centre * 10) / 10, floorDb: Math.round(floorDb * 10) / 10, speech: mono ? [] : gaps.flatMap((g) => voicedSegments(levels, g, o, floorDb)) }
}

/** Measures the mezzanine with ffmpeg and finds unlabelled speech in every gap. */
export async function unlabelledSpeech(mezz: string, gaps: Gap[], words: Pick<Word, 'start' | 'end'>[], signal?: AbortSignal, o: VadOptions = VAD): Promise<VadResult> {
  return findUnlabelledSpeech(await measureLevels(mezz, signal, o), gaps, words, o)
}
