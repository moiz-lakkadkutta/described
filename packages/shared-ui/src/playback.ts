import type { AudioTrack, HlsRendition, KitPlayerRef, PlayerState, TextTrack } from '@moizp/vega-media-kit'
import type { Prefs } from '@described/contracts'
import { captionName } from './models'
import { strings } from './strings'
import { tokens } from './theme/tokens'

/**
 * Player rules without React: track choice, seek steps, the status line, resume. Player.tsx wires them to the kit
 * and the remote; tests run them against a parsed master playlist.
 */
export type CaptionKind = Prefs['captionKind']

// ── Tracks ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** HLS CHARACTERISTICS (RFC 8216 §4.3.4.1; Apple HLS authoring spec). Rich captions carry describes-music-and-sound. */
export const SDH_CHARACTERISTIC = 'public.accessibility.describes-music-and-sound'

/**
 * The audio rendition for AD on/off, by role — never by id. Off picks a main track that is not a description.
 * On Fire OS the kit derives roles from ExoPlayer's track title, i.e. the rendition NAME ("Audio description…"), not
 * HLS CHARACTERISTICS — the pipeline must keep that NAME (09-package.ts).
 */
export function audioTrackFor(tracks: readonly AudioTrack[], ad: boolean): AudioTrack | undefined {
  return ad ? tracks.find((t) => t.roles.includes('description')) : tracks.find((t) => !t.roles.includes('description') && t.roles.includes('main')) ?? tracks.find((t) => !t.roles.includes('description'))
}

/** CHARACTERISTICS per subtitle URI, from the master playlist (the kit's TextTrack keeps only the kind it derived). */
export function characteristicsByUri(renditions: readonly HlsRendition[]): Map<string, string[]> {
  return new Map(renditions.filter((r) => r.type === 'SUBTITLES' && r.uri).map((r) => [r.uri!, r.characteristics]))
}

/**
 * Rich (SDH) or plain: the describes-music-and-sound characteristic when the master playlist has been read; until
 * then (or for a track without a URI) the rendition NAME, which the pipeline writes as "Rich captions".
 */
function isRich(t: TextTrack, chars: ReadonlyMap<string, string[]> | null): boolean {
  const c = t.url ? chars?.get(t.url) : undefined
  return c ? c.includes(SDH_CHARACTERISTIC) : /\b(rich|sdh)\b/i.test(t.label)
}

/**
 * The text track that shows a caption choice, and the kind actually on screen. Rich captions fall back to plain
 * captions (and the other way round) when the title lacks one; the status line then names what is really showing.
 */
export function captionTrackFor(tracks: readonly TextTrack[], want: CaptionKind, chars: ReadonlyMap<string, string[]> | null = null): { track?: TextTrack; kind: CaptionKind } {
  if (want === 'off') return { kind: 'off' }
  if (want === 'descriptions') {
    const track = tracks.find((t) => t.kind === 'descriptions')
    return track ? { track, kind: 'descriptions' } : { kind: 'off' }
  }
  const caps = tracks.filter((t) => t.kind === 'captions' || t.kind === 'subtitles')
  const rich = caps.find((t) => isRich(t, chars))
  const plain = caps.find((t) => !isRich(t, chars))
  const track = want === 'sdh' ? rich ?? plain : plain ?? rich
  return track ? { track, kind: track === rich ? 'sdh' : 'captions' } : { kind: 'off' }
}

/**
 * Text tracks to select: the caption choice, plus the description text while AD and Extended mode are on — its
 * `{extended=1}` cues are where pause–speak–resume starts (DESC-007). `shown` is what the overlay draws.
 */
export function textSelection(tracks: readonly TextTrack[], want: CaptionKind, o: { adOn: boolean; extendedMode: boolean; chars?: ReadonlyMap<string, string[]> | null }) {
  const cap = captionTrackFor(tracks, want, o.chars ?? null)
  const desc = o.adOn && o.extendedMode ? tracks.find((t) => t.kind === 'descriptions') : undefined
  const ids = [...new Set([cap.track?.id, desc?.id].filter((x): x is string => !!x))]
  return { ids, shown: cap.track?.id, kind: cap.kind }
}

// ── Seek ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const SEEK_STEP_S = 10
/** Held ◄►: one step per this many ms of key repeat (Android repeats at ~20 Hz). */
export const SEEK_REPEAT_MS = 200
/** Presses and repeats gather into one seek, sent this long after the last one; the bar shows the target at once. */
export const SEEK_COMMIT_MS = 300
/** Long-press acceleration: 10 s steps for the first 2 s held, 30 s up to 5 s, then 60 s. */
export function seekStep(heldMs: number): number {
  return heldMs < 2000 ? SEEK_STEP_S : heldMs < 5000 ? 30 : 60
}
/** One rule for every seek (keys, transport, resume): from 0 to 1 s before the end, so a seek never ends the film. */
export function clampSeek(s: number, durationS: number | null | undefined): number {
  return Math.max(0, durationS ? Math.min(s, durationS - 1) : s)
}

// ── Resume ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Where playback starts: the saved position, unless it is within the last 30 s (watched — start over). */
export function resumePoint(resumeS: number | null | undefined, durationS: number | null | undefined): number {
  if (!resumeS || resumeS < 1) return 0
  if (durationS && resumeS > durationS - 30) return 0
  return resumeS
}

// ── Status line and time ───────────────────────────────────────────────────────────────────────────────────────────
/** `caption: null` until the track list is known: the line claims nothing about captions before then. */
export function statusLine(o: { state: PlayerState; error: boolean; adOn: boolean; voice: string; caption: CaptionKind | null }): string {
  if (o.error || o.state === 'error') return strings.player.error
  if (o.state === 'ended') return strings.player.ended
  if (o.state === 'loading' || o.state === 'buffering') return strings.player.loading
  if (o.caption === null) return o.adOn ? strings.player.statusOnNoCaptions(o.voice) : strings.player.statusOffNoCaptions
  const cap = o.caption === 'off' ? strings.player.captionsOff : captionName(o.caption)
  return o.adOn ? strings.player.statusOn(o.voice, cap) : strings.player.statusOff(cap)
}
/** 75 → "1:15"; 3725 → "1:02:05". */
export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// ── Audio switch ───────────────────────────────────────────────────────────────────────────────────────────────────
/** What an audio switch needs from the kit player: `setVolume` (0–1, a property update — no reload) and `selectAudio`. */
export type VolumePlayer = Pick<KitPlayerRef, 'selectAudio' | 'setVolume'>
/** Per player: the newest switch (`gen`) and the volume last set, so a newer switch takes over a fade mid-way. */
const fades = new WeakMap<VolumePlayer, { gen: number; v: number }>()
/**
 * Switch the audio rendition inside a fade: down to 0 over half of tokens.motion.crossfadeMs, `selectAudio`, hold at 0
 * for tokens.motion.audioSwitchHoldMs, then back up to 1 over the other half. The hold is for Fire OS: ExoPlayer
 * flushes and resets the audio decoder and AudioTrack 70–110 ms after a switch (logcat "First PTS after Flush or
 * reset"); fading up straight away put that gap mid-fade, where it sounded like a stutter. The kit reports no
 * audio-track-changed event (ExoPlayer publishes none, KIT-029) and `onPosition` is ≤ 4 Hz, too coarse to time this,
 * so the hold is fixed. A second switch on the same player while one is running takes over: the older one stops where
 * it is (it never selects its track, nor raises the volume after the hold), and the newer fades down from the current
 * volume, so the volume always ends at 1. On Vega the kit's `setVolume` is a no-op, so the switch lands after the
 * fade-down without an audible fade. A `selectAudio` that throws is logged and the fade still comes back up to 1.
 * Never rejects; resolves when this switch is done or has given way.
 *
 * `id` is the track id when the switch began. A source change on the same ref during a fade would let the pending
 * `selectAudio` pick an id from the old source; Player changes source only by remounting the kit (`key={attempt}`),
 * which gives a new ref, so that cannot happen today.
 */
export async function crossfadeAudio(p: VolumePlayer, id: string, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), steps = 5): Promise<void> {
  const f = fades.get(p) ?? { gen: 0, v: 1 }
  fades.set(p, f)
  const gen = ++f.gen
  const live = () => f.gen === gen
  const set = (v: number) => { f.v = v; p.setVolume(v) }
  const half = tokens.motion.crossfadeMs / 2, from = f.v
  for (let i = steps - 1; i >= 0; i--) { set((from * i) / steps); await wait(half / steps); if (!live()) return }
  try { p.selectAudio(id) } catch (e) { console.warn('crossfadeAudio: selectAudio failed', e) }
  await wait(tokens.motion.audioSwitchHoldMs); if (!live()) return
  for (let i = 1; i <= steps; i++) { await wait(half / steps); if (!live()) return; set(i / steps) }
}
