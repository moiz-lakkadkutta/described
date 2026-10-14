import { z } from 'zod'

/**
 * A title's people and places (DESC-029, docs/decisions/0012-characters-and-scenes.md): written by an editor in
 * apps/api/prisma/titles.json from evidence only — the dialogue, on-screen text and credits, the frames, the synopsis — and read by
 * the pipeline (describe prompt, scene step, fit, edit pass and its grounding guard). Times are seconds on the SEGMENT's clock
 * (the slug's first number is where the segment starts in the film). A name counts as revealed only once it is spoken or shown inside
 * the segment.
 *
 * Voice: `look` and `role` introduce the character as a director would to an audience — vivid, story-aware, short. Guardrails: only
 * what a sighted viewer can see in the frames, or has been told by that point; no thoughts, intentions or later plot. `look` is used
 * from the first shot; the name only once `revealedAtS` has passed (never when it is null), and only for a figure matching the look;
 * `role` is never voiced.
 */
export const Character = z.object({
  /** The name the film gives (dialogue, on-screen text or credits). Never voiced before revealedAtS, never when that is null. */
  name: z.string().min(1),
  /** Stable visible descriptors, the one way to refer to this character until the name is revealed ("a thin young man with short dark hair, in a pale green shirt"). */
  look: z.string().min(1),
  /** A short reference made of words from the look ("the thin young man"): what a cue says in place of a name it may not use yet. */
  short: z.string().min(1),
  /** Their part in the story as the film has shown or told it by revealedAtS. Background for the edit pass's choices only: never words in a cue, never in the describe prompt. */
  role: z.string().min(1),
  /** Segment seconds at which the name is first spoken or shown INSIDE the segment; null = not revealed inside it (a name said before the segment starts does not count: decision 0012). */
  revealedAtS: z.number().nullable(),
  /** Where the name comes from: the line, the subtitle file and its time, the credit or title card. */
  nameEvidence: z.string().min(1),
})
export type Character = z.infer<typeof Character>

export const Setting = z.object({
  /** How the description names the place ("the tent"); visual unless the film names it (by the same reveal rule as names). */
  name: z.string().min(1),
  /** What it looks like, in the words a describer would use ("a dim round hide tent with a fire pit in the middle"). */
  look: z.string().min(1),
  /** Segment seconds where the place is first seen, when known. */
  firstAtS: z.number().optional(),
})
export type Setting = z.infer<typeof Setting>

export const Glossary = z.object({ characters: z.array(Character).default([]), settings: z.array(Setting).default([]) })
export type Glossary = z.infer<typeof Glossary>

/** A character's name may be voiced at segment time `atMs` (revealedAtS not null and ≤ atMs / 1000). */
export const nameRevealed = (c: Pick<Character, 'revealedAtS'>, atMs: number) => c.revealedAtS !== null && c.revealedAtS * 1000 <= atMs
