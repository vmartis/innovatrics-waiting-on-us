import { createApp } from './app.ts'
import { applySchema, pool } from './db.ts'
import { describe } from './errors.ts'

const PORT = Number(process.env.PORT ?? 3000)
// All interfaces, because the tunnel that publishes the live URL reaches this
// container from outside: binding to 127.0.0.1 makes the live URL answer 502
// (measured). That means anyone who can reach this port can read the sample
// data and claim threads — accepted for a disposable box with synthetic data,
// and the reason a real deployment needs the login in PLAN.md item N8.
const HOST = process.env.HOST ?? '0.0.0.0'

// Our tables exist before the first request. This costs a few milliseconds of
// a cold start and keeps the first claim in S2 from hitting a missing table.
// If it fails we still serve the app: the list is read-only and works.
await applySchema().catch((err: unknown) => {
  console.error(`schema setup failed, claims will not work: ${describe(err)}`)
})

const server = createApp().listen(PORT, HOST, () => {
  console.log(`listening on ${HOST}:${PORT}`)
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0))
    })
  })
}
