import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

/**
 * Where our own tables live. Tests set APP_SCHEMA so they can create, fill and
 * empty their own `thread_claims` without touching the claims of people using
 * the deployed app — same database, same read-only `requests`, separate state.
 */
const SCHEMA = schemaName(process.env.APP_SCHEMA ?? 'public')

function schemaName(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,30}$/.test(value)) {
    throw new Error('APP_SCHEMA must be a plain lower-case identifier')
  }
  return value
}

/**
 * The candidate-app service runs as the OS user `candidate`, which Postgres
 * maps to the role of the same name over the local unix socket. No password
 * and no secret is needed or stored anywhere.
 */
export const pool = new Pool({
  host: process.env.PGHOST ?? '/var/run/postgresql',
  database: process.env.PGDATABASE ?? 'app',
  user: process.env.PGUSER ?? process.env.USER ?? 'candidate',
  max: 5,
  // A dead database must fail fast, never hang the startup or a request.
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  // `public` stays on the path so the sample table `requests` is found.
  options: `-c search_path=${SCHEMA},public`,
})

/**
 * Create our own tables if they are missing. Runs on every startup and is
 * safe to repeat. The sample table `requests` is never touched.
 */
export async function applySchema(): Promise<void> {
  const file = path.join(import.meta.dirname, 'schema.sql')
  const sql = await readFile(file, 'utf8')
  if (SCHEMA !== 'public') await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
  await pool.query(sql)
}
