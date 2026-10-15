/**
 * How faults are described in the server log.
 *
 * Customer names, contact names and message bodies must never reach a log, so
 * only the error name, code and message are used. Postgres puts offending row
 * values in `detail`, which is deliberately never read here.
 */
export function describe(err: unknown): string {
  if (!(err instanceof Error)) return 'UnknownError'
  const code = (err as { code?: unknown }).code
  const prefix = typeof code === 'string' && code ? `${err.name}/${code}` : err.name
  return err.message ? `${prefix}: ${err.message}` : prefix
}

/** Client mistakes stay 4xx; everything unexpected is a 500. */
export function errorStatus(err: unknown): number {
  const raw = err as { status?: unknown; statusCode?: unknown } | null
  const status = typeof raw?.status === 'number' ? raw.status : raw?.statusCode
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500
}
