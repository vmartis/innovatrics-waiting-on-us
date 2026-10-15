/**
 * How long a customer has been waiting, in words.
 *
 * A timestamp does not answer the question a teammate is actually asking —
 * "is this one bad?". "9 days" does. The wording is deliberately coarse: an
 * hour either way never changes what you do next, so there is no point
 * printing minutes once something has been sitting for days.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Milliseconds waited, clamped to 0 for a future or unreadable timestamp. */
export function waitedMs(since: string, now: Date): number {
  const elapsed = now.getTime() - new Date(since).getTime()
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0
}

/**
 * "just now", "40 minutes", "3 hours", "1 day", "12 days". Never a sentence,
 * so it fits in a table cell next to other cells.
 */
export function waitedFor(since: string, now: Date): string {
  const elapsed = waitedMs(since, now)

  if (elapsed < 5 * MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} minutes`
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  const days = Math.floor(elapsed / DAY)
  return days === 1 ? '1 day' : `${days} days`
}

/**
 * True once a wait is long enough to be worth pointing at. Three days is a
 * judgement, not a rule from the assignment — it is the point where "we have
 * not replied yet" stops being normal.
 */
export function isLongWait(since: string, now: Date): boolean {
  return waitedMs(since, now) >= 3 * DAY
}
