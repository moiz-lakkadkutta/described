/**
 * Runs async tasks one at a time, in order, so an older request can never land after a newer one (settings, playback
 * position). A failed task never blocks the next; the caller's promise still rejects so it can react.
 */
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task)
    tail = run.catch(() => {})
    return run
  }
}
