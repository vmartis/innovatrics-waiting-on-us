import path from 'node:path'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { describe, errorStatus } from './errors.ts'
import { claimsRouter } from './routes/claims.ts'
import { threadsRouter } from './routes/threads.ts'
import { topicsRouter } from './routes/topics.ts'
import { TEAM } from '../lib/team.ts'

/**
 * The built SPA. Resolved from the working directory, which is /srv/project
 * both for the systemd service and when running tests or the dev server.
 */
const WEB_DIST = path.resolve(process.cwd(), 'web', 'dist')

export function createApp(): Express {
  const app = express()
  app.disable('x-powered-by')

  // Proportionate hardening: the SPA only ever loads its own assets and talks
  // to its own /api, so everything else can be refused.
  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; " +
        "form-action 'none'",
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })

  // Everything under /api is per-person once identity exists, so no cache may
  // ever hand one teammate's answer to another.
  app.use('/api', express.json({ limit: '32kb' }), (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  // An authorization gate belongs here: after the /api prefix is known, before
  // the routers, so it never blocks the SPA assets or the sign-in screen.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })
  // Who may take responsibility for a thread. No password: see lib/team.ts.
  app.get('/api/team', (_req, res) => {
    res.json({ team: TEAM })
  })
  app.use('/api/threads', claimsRouter)
  app.use('/api/threads', topicsRouter)
  app.use('/api/threads', threadsRouter)

  // Anything else under /api is a mistake, not a page.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  app.use(express.static(WEB_DIST, { index: false }))
  // Client-side routing: every other GET renders the SPA. `root` matters:
  // without it `send` refuses the whole absolute path when any folder in it
  // starts with a dot (a checkout under ~/.something answered every page 404).
  app.get(/.*/, (_req, res) => {
    res.sendFile('index.html', { root: WEB_DIST })
  })

  // Customer text and names must never reach a log or a response body, so the
  // client gets a fixed message. The log keeps the error code and message,
  // which identify the fault without naming anybody: pg puts row values in
  // `detail`, which is never logged.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const status = errorStatus(err)
    console.error(`${req.method} ${req.path} failed (${status}): ${describe(err)}`)
    if (res.headersSent) {
      next(err)
      return
    }
    res.status(status).json({ error: status < 500 ? 'bad request' : 'something went wrong' })
  })

  return app
}
