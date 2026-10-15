import { ANNOUNCE_DEBOUNCE_MS } from './a11y'
/**
 * App-voice prompts (FirstRun panels, Settings' voice preview): the newest request wins. Pressing fast must never pile
 * clips up or play two at once.
 *
 * - `say` stops whatever is speaking at once (flush, not queue), then waits `debounceMs` before starting the clip, so a
 *   burst of presses loads and plays only the last one.
 * - A generation token drops stale work: a request superseded during the wait never starts, and a clip's promise that
 *   settles late (out of order) reports `false` so callers do not act on it.
 * - `cancel` stops the clip and drops a pending one (leaving the screen).
 *
 * Callers that want clips in order (Player's extended cues) keep their own queue and call `speak` directly.
 */
export const PROMPT_DEBOUNCE_MS = ANNOUNCE_DEBOUNCE_MS
export type PromptVoice = {
  /** Resolves `true` when this clip ended as the newest request, `false` when something newer replaced it. */
  say: (url: string) => Promise<boolean>
  cancel: () => void
}
export function createPromptVoice(speak: (url: string) => Promise<void>, stop: () => void, debounceMs = PROMPT_DEBOUNCE_MS): PromptVoice {
  let gen = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: ((current: boolean) => void) | undefined
  /** Ends the request waiting out the debounce (it never started) and the clip in flight. */
  const flush = () => {
    clearTimeout(timer); timer = undefined
    const p = pending; pending = undefined; p?.(false)
    stop()
  }
  return {
    say(url) {
      const mine = ++gen
      flush()
      return new Promise<boolean>((resolve) => {
        pending = resolve
        timer = setTimeout(() => {
          timer = undefined; pending = undefined
          if (mine !== gen) { resolve(false); return }
          speak(url).catch(() => {}).then(() => resolve(mine === gen))
        }, debounceMs)
      })
    },
    cancel() { gen++; flush() },
  }
}
