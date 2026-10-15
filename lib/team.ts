/**
 * Who can take responsibility for a thread.
 *
 * A teammate picks their name from this list; there is no password. That was a
 * recorded decision (DECISIONS.md, 14:26): README.md asks for responsibility
 * to be visible, not for security. The list is the only accepted set of names,
 * so a claim can never carry made-up text — but anybody using the app can pick
 * any name, so a name shows who took a thread, it does not prove it.
 *
 * These are placeholder teammates. A real sign-in (PLAN.md, item N8) replaces
 * this file and server/currentPerson.ts, and nothing else.
 */
export const TEAM = ['Alex Moore', 'Priya Shah', 'Tom Becker', 'Lena Fischer'] as const

export type TeamMember = (typeof TEAM)[number]

/** Accept only a name from the list; everything else is rejected input. */
export function asTeamMember(value: unknown): TeamMember | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return (TEAM as readonly string[]).includes(name) ? (name as TeamMember) : null
}
