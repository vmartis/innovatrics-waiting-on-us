import type { Request } from 'express'
import { asTeamMember, type TeamMember } from '../lib/team.ts'

/**
 * Who is making this request.
 *
 * Today the name comes from the request body, because the team picks a name
 * instead of signing in (see DECISIONS.md). It is read in exactly one place so
 * that a real login replaces this function and nothing else — in particular
 * there is then no body field left to fall back on, which is how
 * impersonation holes get built.
 *
 * A name is only accepted if it is on the team list, so our table can never
 * hold invented or free-text names. The name is a label that shows who took
 * responsibility; it is not proof of who acted.
 */
export function currentPerson(req: Request): TeamMember | null {
  return asTeamMember((req.body as { person?: unknown } | undefined)?.person)
}
