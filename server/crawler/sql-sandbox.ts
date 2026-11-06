import { spawn } from 'node:child_process'
import { crawlFilePath } from './store'

/**
 * Read-only SQL over a crawl file for agents and power users.
 *
 * The query runs in a short-lived child process: a runaway query (e.g. an
 * endless recursive CTE) cannot be interrupted inside a worker thread because
 * SQLite never yields back to JavaScript, but a process can always be killed.
 * Inside the child the connection is read-only and an authorizer only allows
 * reading statements (no PRAGMA, ATTACH, writes or extensions).
 */

export interface SqlResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated: boolean
  durationMs: number
}

export class SqlQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlQueryError'
  }
}

const CHILD_SCRIPT = `
const { DatabaseSync, constants } = await import('node:sqlite')
const [file, sql, maxRowsArg] = process.argv.slice(1)
const maxRows = Number(maxRowsArg)
const out = (value) => process.stdout.write(JSON.stringify(value))
try {
  const db = new DatabaseSync(file, { readOnly: true })
  db.exec('PRAGMA hard_heap_limit = 268435456')
  if (typeof db.setAuthorizer === 'function') {
    const allowed = new Set([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_FUNCTION, constants.SQLITE_RECURSIVE])
    db.setAuthorizer((action) => (allowed.has(action) ? constants.SQLITE_OK : constants.SQLITE_DENY))
  }
  const stmt = db.prepare(sql)
  const rows = []
  let truncated = false
  for (const row of stmt.iterate()) {
    if (rows.length >= maxRows) { truncated = true; break }
    const clean = {}
    for (const [key, value] of Object.entries(row)) {
      clean[key] = value instanceof Uint8Array ? '[blob ' + value.length + ' bytes]' : typeof value === 'bigint' ? value.toString() : value
    }
    rows.push(clean)
  }
  const columns = typeof stmt.columns === 'function' ? stmt.columns().map((c) => c.name) : Object.keys(rows[0] ?? {})
  out({ columns, rows, truncated })
} catch (error) {
  out({ error: String(error && error.message || error) })
}
`

const READ_ONLY_START = /^\s*(with|select|values|explain)\b/i
/** Defense in depth; the read-only connection and the authorizer are the real guard. */
const FORBIDDEN = /\b(attach|detach|pragma|vacuum|load_extension)\b/i

export function validateSql(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (!trimmed) throw new SqlQueryError('Empty query')
  if (trimmed.length > 10_000) {
    throw new SqlQueryError('Query too long (max. 10,000 characters)')
  }
  if (!READ_ONLY_START.test(trimmed)) {
    throw new SqlQueryError('Only SELECT / WITH queries are allowed')
  }
  const code = trimmed.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "''")
  if (code.includes(';')) {
    throw new SqlQueryError('Only a single statement is allowed')
  }
  if (FORBIDDEN.test(code)) {
    throw new SqlQueryError(
      'The query contains a statement that is not allowed',
    )
  }
  return trimmed
}

export function runReadOnlySql(
  crawlId: string,
  sql: string,
  options: { maxRows?: number; timeoutMs?: number } = {},
): Promise<SqlResult> {
  const query = validateSql(sql)
  const maxRows = Math.min(Math.max(options.maxRows ?? 200, 1), 500)
  const timeoutMs = options.timeoutMs ?? 10_000
  const file = crawlFilePath(crawlId)
  const started = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', CHILD_SCRIPT, file, query, String(maxRows)],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        env: { PATH: process.env.PATH ?? '' },
      },
    )
    let stdout = ''
    let stderr = ''
    // Decode across chunk boundaries (umlauts split between two pipe chunks).
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > 20 * 1024 * 1024) child.kill('SIGKILL')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => reject(new SqlQueryError(error.message)))
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL') {
        reject(
          new SqlQueryError(
            `Query stopped after ${Math.round(timeoutMs / 1000)}s or too much output. Add a LIMIT or narrow the query.`,
          ),
        )
        return
      }
      try {
        const parsed = JSON.parse(stdout) as
          | { error: string }
          | {
              columns: string[]
              rows: Array<Record<string, unknown>>
              truncated: boolean
            }
        if ('error' in parsed) {
          reject(new SqlQueryError(parsed.error))
          return
        }
        resolve({ ...parsed, durationMs: Date.now() - started })
      } catch {
        reject(
          new SqlQueryError(
            `Query process failed (exit ${code}): ${stderr.trim().slice(0, 300)}`,
          ),
        )
      }
    })
  })
}
