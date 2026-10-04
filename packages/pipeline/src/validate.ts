import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { audioTracksFromHls, normalizeRoles, parseHlsMaster, parseVtt, textTracksFromHls, type HlsMaster } from '@moizp/vega-media-kit/core'
import type { PackageReport } from './steps/09-package'

/**
 * Step `validate` (between package and publish): the HLS master and the whole-file VTTs are read back with the kit's parsers —
 * the ones the app plays through — so a manifest the Fire TV audio-track selector would mislabel never reaches S3
 * (decision 0004: kit parsers, not Shaka's, so this runs in Node and CI). Writes work/validate.json (cue counts for the
 * TextTrack rows, persisted by src/jobs.ts) and throws when anything is wrong. RFC 8216 §4.3.4.1 (EXT-X-MEDIA, CHARACTERISTICS):
 * https://datatracker.ietf.org/doc/html/rfc8216#section-4.3.4.1 · Apple's accessibility characteristics:
 * https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices
 */
export const VTT_FILES = ['captions.vtt', 'sdh.vtt', 'descriptions.vtt'] as const
export type VttFile = typeof VTT_FILES[number]
export interface ManifestProblems { problems: string[]; audio: string[]; text: string[]; vttCues: Record<VttFile, number> }

const DESCRIBES_VIDEO = 'public.accessibility.describes-video'
const DESCRIBES_SOUND = 'public.accessibility.describes-music-and-sound'
type Kind = keyof PackageReport['tracks']
/** What 09-package names each text track (hls_name), for messages. */
const TRACK_NAME: Record<Kind, string> = { captions: 'Captions', sdh: 'Rich captions', descriptions: 'Description text' }

const parse = (masterText: string, baseUrl: string): HlsMaster | string => {
  try { return parseHlsMaster(masterText, baseUrl) } catch (e) { return `master.m3u8: ${(e as Error).message}` }
}

/**
 * Pure. Problems with a master playlist against what 09-package meant to advertise (`expect`), [] when it is right:
 * exactly two audio renditions — "Original" (role main) and one whose CHARACTERISTICS carry describes-video; a text track
 * present exactly when its flag is set (Rich captions = describes-music-and-sound; Description text by the kit's
 * label rule, as the app classifies it); no `%20` in any NAME (Packager's hls_name takes real spaces).
 */
export function checkMaster(masterText: string, baseUrl: string, expect: PackageReport['tracks']): string[] {
  const m = parse(masterText, baseUrl)
  if (typeof m === 'string') return [m]
  const problems: string[] = []
  const audio = m.renditions.filter((r) => r.type === 'AUDIO')
  if (audio.length !== 2) problems.push(`expected 2 audio renditions (Original, Audio description), found ${audio.length}`)
  // By name (trimmed, as the kit's labelFor reads it) and characteristics on the rendition itself; roles as the kit derives them.
  const original = audio.find((r) => r.name.trim() === 'Original' && !r.characteristics.includes(DESCRIBES_VIDEO))
  if (!original || !normalizeRoles(original.characteristics).includes('main')) problems.push('no main audio rendition named "Original"')
  if (!audio.some((r) => r.characteristics.includes(DESCRIBES_VIDEO))) problems.push(`no audio rendition has CHARACTERISTICS ${DESCRIBES_VIDEO}`)

  const sound = new Set(m.renditions.filter((r) => r.type === 'SUBTITLES' && r.characteristics.includes(DESCRIBES_SOUND)).map((r) => r.uri))
  const found = new Map<Kind, string[]>()
  for (const t of textTracksFromHls(m)) {
    const kind: Kind = sound.has(t.url) ? 'sdh' : t.kind === 'descriptions' ? 'descriptions' : 'captions'
    found.set(kind, [...(found.get(kind) ?? []), t.label])
  }
  for (const kind of Object.keys(TRACK_NAME) as Kind[]) {
    const names = found.get(kind) ?? []
    if (names.length > 1) problems.push(`${kind}: ${names.length} text tracks (${names.join(', ')}), expected one`)
    if (names.length && !expect[kind]) problems.push(`text track "${names[0]}" (${kind}) is advertised but was not expected`)
    if (!names.length && expect[kind]) problems.push(`text track "${TRACK_NAME[kind]}" (${kind}) is missing`)
  }
  for (const r of m.renditions) if ((r.attributes['NAME'] ?? '').includes('%20')) problems.push(`%20 in NAME="${r.attributes['NAME']}" (use a real space)`)
  return problems
}

const VTT_KIND: Record<VttFile, Kind> = { 'captions.vtt': 'captions', 'sdh.vtt': 'sdh', 'descriptions.vtt': 'descriptions' }

/**
 * Reads work/hls/master.m3u8 and work/package.json (09-package), parses the three whole-file VTTs with the kit's parseVtt
 * (header-only ⇒ 0 cues, allowed unless its track is advertised), writes work/validate.json and throws
 * Error(problems.join('\n')) when there is any problem.
 */
export async function validateWork(work: string): Promise<ManifestProblems> {
  const report = JSON.parse(await readFile(`${work}/package.json`, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') throw new Error('work/package.json missing: run --from package first')
    throw e
  })) as PackageReport
  const masterFile = resolve(work, 'hls/master.m3u8')
  const masterText = await readFile(masterFile, 'utf8').catch(() => '')
  const baseUrl = pathToFileURL(masterFile).href
  const problems = checkMaster(masterText, baseUrl, report.tracks)
  const m = parse(masterText, baseUrl)
  const vttCues = {} as Record<VttFile, number>
  for (const f of VTT_FILES) {
    const text = await readFile(`${work}/${f}`, 'utf8').catch(() => null)
    if (text === null) { problems.push(`${f} is missing`); vttCues[f] = 0; continue }
    if (!/^(﻿)?WEBVTT/.test(text)) problems.push(`${f} does not start with WEBVTT`)
    vttCues[f] = parseVtt(text, { trackId: VTT_KIND[f] }).length
    if (vttCues[f] === 0 && report.tracks[VTT_KIND[f]]) problems.push(`${f} has 0 cues but its track is advertised`)
  }
  const result: ManifestProblems = {
    problems,
    audio: typeof m === 'string' ? [] : audioTracksFromHls(m).map((t) => t.label),
    text: typeof m === 'string' ? [] : textTracksFromHls(m).map((t) => t.label),
    vttCues,
  }
  await writeFile(`${work}/validate.json`, JSON.stringify(result, null, 2))
  if (problems.length) throw new Error(problems.join('\n'))
  return result
}
