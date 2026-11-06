import type { DatabaseSync } from 'node:sqlite'
import Papa from 'papaparse'
import {
  ISSUE_BY_ID,
  ISSUE_CATALOG,
  type IssueDefinition,
  SEVERITY_ORDER,
  type Severity,
} from './catalog'
import { type CrawlProgress, getCrawlJob } from './engine'
import {
  type CrawlStatus,
  crawlExists,
  crawlFileSize,
  isValidCrawlId,
  listCrawlIds,
  openCrawlReadOnly,
  readMeta,
} from './store'

/**
 * Read layer over crawl files, shared by the REST API (UI) and the MCP tools
 * so both always show the same numbers.
 */

export class CrawlQueryError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'CrawlQueryError'
  }
}

function withCrawl<T>(crawlId: string, fn: (db: DatabaseSync) => T): T {
  if (!isValidCrawlId(crawlId) || !crawlExists(crawlId)) {
    throw new CrawlQueryError(
      `Unknown crawl id "${crawlId}". Use list_crawls to see available crawls.`,
      404,
    )
  }
  const db = openCrawlReadOnly(crawlId)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export interface SeverityCounts {
  error: number
  warning: number
  notice: number
}

export interface CrawlSummary {
  crawlId: string
  startUrl: string
  status: CrawlStatus
  source: string
  startedAt: string | null
  finishedAt: string | null
  urlsFetched: number
  issues: SeverityCounts
  sizeBytes: number
  progress?: CrawlProgress
}

function severityCounts(issueCounts: Record<string, number>): SeverityCounts {
  const counts: SeverityCounts = { error: 0, warning: 0, notice: 0 }
  for (const [id, n] of Object.entries(issueCounts)) {
    const severity = ISSUE_BY_ID.get(id)?.severity
    if (severity) counts[severity] += n
  }
  return counts
}

function summarize(crawlId: string, db: DatabaseSync): CrawlSummary {
  const meta = readMeta(db)
  const job = getCrawlJob(crawlId)
  let status = (meta.status as CrawlStatus) || 'interrupted'
  // A "running" file without a live job was interrupted by a server restart.
  if (status === 'running' && !job?.isRunning) status = 'interrupted'
  const stats = parseJson<{ fetched?: number }>(meta.stats, {})
  const fetched =
    stats.fetched ??
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state = 'fetched'",
        )
        .get() as { n: number }
    ).n
  return {
    crawlId,
    startUrl: meta.start_url ?? '',
    status,
    source: meta.source ?? 'api',
    startedAt: meta.started_at ?? null,
    finishedAt: meta.finished_at ?? null,
    urlsFetched: fetched,
    issues: severityCounts(parseJson(meta.issue_counts, {})),
    sizeBytes: crawlFileSize(crawlId),
    progress: job?.isRunning ? job.progress : undefined,
  }
}

export function listCrawls(): CrawlSummary[] {
  const summaries: CrawlSummary[] = []
  for (const crawlId of listCrawlIds()) {
    try {
      summaries.push(withCrawl(crawlId, (db) => summarize(crawlId, db)))
    } catch {
      // Unreadable or foreign file: skip it instead of breaking the list.
    }
  }
  return summaries
}

export interface IssueSummary extends IssueDefinition {
  count: number
  examples: Array<{ url: string; detail: string | null }>
}

function issueSummaries(
  db: DatabaseSync,
  filter: {
    severity?: Severity
    category?: string
    includeEmpty?: boolean
  } = {},
  examplesPerIssue = 5,
): IssueSummary[] {
  const counts = new Map(
    (
      db
        .prepare('SELECT issue_id, COUNT(*) AS n FROM issues GROUP BY issue_id')
        .all() as Array<{ issue_id: string; n: number }>
    ).map((row) => [row.issue_id, row.n]),
  )
  const examples = db.prepare(
    `SELECT u.url, i.detail FROM issues i JOIN urls u ON u.id = i.url_id
     WHERE i.issue_id = ? ORDER BY u.url LIMIT ?`,
  )
  return ISSUE_CATALOG.filter(
    (issue) =>
      (!filter.severity || issue.severity === filter.severity) &&
      (!filter.category || issue.category === filter.category) &&
      (filter.includeEmpty || (counts.get(issue.id) ?? 0) > 0),
  )
    .map((issue) => ({
      ...issue,
      count: counts.get(issue.id) ?? 0,
      examples:
        examplesPerIssue > 0
          ? (examples.all(issue.id, examplesPerIssue) as Array<{
              url: string
              detail: string | null
            }>)
          : [],
    }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.count - a.count,
    )
}

export function listIssues(
  crawlId: string,
  filter: {
    severity?: Severity
    category?: string
    includeEmpty?: boolean
  } = {},
): IssueSummary[] {
  if (filter.severity && !(filter.severity in SEVERITY_ORDER)) {
    throw new CrawlQueryError('severity must be one of error, warning, notice')
  }
  return withCrawl(crawlId, (db) => issueSummaries(db, filter))
}

export interface CrawlOverview {
  crawl: CrawlSummary
  config: Record<string, unknown>
  totals: {
    urls: number
    internal: number
    external: number
    fetched: number
    htmlPages: number
    indexable: number
    nonIndexable: number
    blockedByRobots: number
    failed: number
    notCrawled: number
  }
  statusCodes: Record<string, number>
  indexability: Record<string, number>
  depth: Array<{ depth: number | null; count: number }>
  responseTimeMs: { average: number | null; max: number | null }
  topIssues: IssueSummary[]
}

export function getOverview(crawlId: string): CrawlOverview {
  return withCrawl(crawlId, (db) => {
    const meta = readMeta(db)
    const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n
    const statusRows = db
      .prepare(
        `SELECT CASE
           WHEN crawl_state = 'blocked_robots' THEN 'blocked'
           WHEN crawl_state IN ('failed', 'blocked_target') THEN 'failed'
           WHEN crawl_state <> 'fetched' THEN 'not crawled'
           WHEN status_code BETWEEN 200 AND 299 THEN '2xx'
           WHEN status_code BETWEEN 300 AND 399 THEN '3xx'
           WHEN status_code BETWEEN 400 AND 499 THEN '4xx'
           WHEN status_code >= 500 THEN '5xx'
           ELSE 'other' END AS bucket, COUNT(*) AS n
         FROM urls WHERE is_internal = 1 GROUP BY bucket`,
      )
      .all() as Array<{ bucket: string; n: number }>
    const indexabilityRows = db
      .prepare(
        `SELECT COALESCE(indexability_reason, 'indexable') AS reason, COUNT(*) AS n
         FROM urls WHERE is_internal = 1 AND indexable IS NOT NULL GROUP BY reason`,
      )
      .all() as Array<{ reason: string; n: number }>
    const response = db
      .prepare(
        `SELECT AVG(response_ms) AS average, MAX(response_ms) AS max FROM urls
         WHERE is_internal = 1 AND crawl_state = 'fetched' AND is_html = 1`,
      )
      .get() as { average: number | null; max: number | null }
    return {
      crawl: summarize(crawlId, db),
      config: parseJson(meta.config, {}),
      totals: {
        urls: one('SELECT COUNT(*) AS n FROM urls'),
        internal: one('SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1'),
        external: one('SELECT COUNT(*) AS n FROM urls WHERE is_internal = 0'),
        fetched: one(
          "SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state = 'fetched'",
        ),
        htmlPages: one(
          "SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state = 'fetched' AND is_html = 1 AND status_code BETWEEN 200 AND 299",
        ),
        indexable: one(
          'SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND indexable = 1',
        ),
        nonIndexable: one(
          'SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND indexable = 0',
        ),
        blockedByRobots: one(
          "SELECT COUNT(*) AS n FROM urls WHERE crawl_state = 'blocked_robots'",
        ),
        failed: one(
          "SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state IN ('failed', 'blocked_target')",
        ),
        notCrawled: one(
          "SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state IN ('skipped_limit', 'excluded', 'pending')",
        ),
      },
      statusCodes: Object.fromEntries(statusRows.map((r) => [r.bucket, r.n])),
      indexability: Object.fromEntries(
        indexabilityRows.map((r) => [r.reason, r.n]),
      ),
      depth: db
        .prepare(
          `SELECT depth, COUNT(*) AS count FROM urls
           WHERE is_internal = 1 AND crawl_state = 'fetched' AND is_html = 1
           GROUP BY depth ORDER BY depth IS NULL, depth`,
        )
        .all() as Array<{ depth: number | null; count: number }>,
      responseTimeMs: {
        average:
          response.average === null ? null : Math.round(response.average),
        max: response.max,
      },
      topIssues: issueSummaries(db, {}, 3).slice(0, 10),
    }
  })
}

/** Columns that may be selected and sorted on (whitelist, no SQL injection). */
export const URL_COLUMNS = [
  'url',
  'is_internal',
  'found_via',
  'depth',
  'crawl_state',
  'status_code',
  'final_url',
  'final_status',
  'redirect_hops',
  'content_type',
  'response_ms',
  'size_bytes',
  'title',
  'title_length',
  'meta_description',
  'meta_description_length',
  'h1',
  'h1_count',
  'h2_count',
  'canonical_url',
  'meta_robots',
  'x_robots_tag',
  'noindex',
  'indexable',
  'indexability_reason',
  'lang',
  'word_count',
  'images_missing_alt',
  'in_sitemap',
  'inlinks',
  'outlinks',
  'external_outlinks',
  'error',
  'issue_count',
] as const

export type UrlColumn = (typeof URL_COLUMNS)[number]

export const DEFAULT_URL_COLUMNS: UrlColumn[] = [
  'url',
  'status_code',
  'indexable',
  'indexability_reason',
  'title',
  'depth',
  'inlinks',
  'response_ms',
  'word_count',
  'issue_count',
]

export const URL_FILTERS = {
  all: '1 = 1',
  internal: 'u.is_internal = 1',
  external: 'u.is_internal = 0',
  html: "u.is_internal = 1 AND u.crawl_state = 'fetched' AND u.is_html = 1",
  indexable: 'u.is_internal = 1 AND u.indexable = 1',
  'non-indexable': 'u.is_internal = 1 AND u.indexable = 0',
  '2xx': "u.crawl_state = 'fetched' AND u.status_code BETWEEN 200 AND 299",
  '3xx': "u.crawl_state = 'fetched' AND u.status_code BETWEEN 300 AND 399",
  '4xx': "u.crawl_state = 'fetched' AND u.status_code BETWEEN 400 AND 499",
  '5xx': "u.crawl_state = 'fetched' AND u.status_code >= 500",
  failed: "u.crawl_state IN ('failed', 'blocked_target')",
  blocked: "u.crawl_state = 'blocked_robots'",
  'not-crawled':
    "u.crawl_state IN ('skipped_limit', 'excluded', 'pending', 'not_checked')",
} as const

export type UrlFilter = keyof typeof URL_FILTERS

export interface UrlQuery {
  filter?: string
  issueId?: string
  search?: string
  columns?: string[]
  sort?: string
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface UrlQueryResult {
  total: number
  offset: number
  limit: number
  columns: string[]
  rows: Array<Record<string, unknown>>
}

function columnSql(column: UrlColumn): string {
  return column === 'issue_count'
    ? '(SELECT COUNT(*) FROM issues x WHERE x.url_id = u.id) AS issue_count'
    : `u.${column}`
}

export function queryUrls(crawlId: string, query: UrlQuery): UrlQueryResult {
  const filter = (query.filter ?? 'all') as UrlFilter
  if (!(filter in URL_FILTERS)) {
    throw new CrawlQueryError(
      `Unknown filter "${query.filter}". Valid: ${Object.keys(URL_FILTERS).join(', ')}`,
    )
  }
  if (query.issueId && !ISSUE_BY_ID.has(query.issueId)) {
    throw new CrawlQueryError(
      `Unknown issue id "${query.issueId}". Use list_issues for valid ids.`,
    )
  }
  const requested = query.columns?.length ? query.columns : DEFAULT_URL_COLUMNS
  const invalid = requested.filter(
    (c) => !(URL_COLUMNS as readonly string[]).includes(c),
  )
  if (invalid.length) {
    throw new CrawlQueryError(
      `Unknown column(s): ${invalid.join(', ')}. Valid: ${URL_COLUMNS.join(', ')}`,
    )
  }
  const columns = [...new Set(['url', ...requested])] as UrlColumn[]
  const sort = (query.sort ?? 'url') as UrlColumn
  if (!(URL_COLUMNS as readonly string[]).includes(sort)) {
    throw new CrawlQueryError(`Cannot sort by "${query.sort}"`)
  }
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'
  const limit = Math.min(Math.max(Math.round(query.limit ?? 50), 1), 500)
  const offset = Math.max(Math.round(query.offset ?? 0), 0)

  const where: string[] = [URL_FILTERS[filter]]
  const params: Array<string | number> = []
  let join = ''
  const select = columns.map(columnSql)
  if (query.issueId) {
    join = 'JOIN issues i ON i.url_id = u.id AND i.issue_id = ?'
    params.push(query.issueId)
    select.push('i.detail AS issue_detail')
  }
  if (query.search?.trim()) {
    where.push("(u.url LIKE ? ESCAPE '\\' OR u.title LIKE ? ESCAPE '\\')")
    const like = `%${query.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`
    params.push(like, like)
  }
  const whereSql = where.join(' AND ')
  const orderBy =
    sort === 'issue_count'
      ? `(SELECT COUNT(*) FROM issues x WHERE x.url_id = u.id) ${direction}`
      : `u.${sort} IS NULL, u.${sort} ${direction}`

  return withCrawl(crawlId, (db) => {
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM urls u ${join} WHERE ${whereSql}`)
        .get(...params) as { n: number }
    ).n
    const rows = db
      .prepare(
        `SELECT ${select.join(', ')} FROM urls u ${join} WHERE ${whereSql}
         ORDER BY ${orderBy}, u.id LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>
    return {
      total,
      offset,
      limit,
      columns: query.issueId ? [...columns, 'issue_detail'] : columns,
      rows,
    }
  })
}

export interface UrlDetails {
  url: Record<string, unknown>
  issues: Array<{
    id: string
    severity: Severity
    title: string
    detail: string | null
  }>
  inlinks: {
    total: number
    items: Array<{ source: string; anchor: string | null; nofollow: number }>
  }
  outlinks: {
    total: number
    items: Array<{
      target: string
      anchor: string | null
      nofollow: number
      is_internal: number
      status_code: number | null
    }>
  }
  hreflang: Array<{ lang: string; target: string; status_code: number | null }>
  redirectChain: Array<{ url: string; status: number | null }>
  sitemaps: string[]
}

export function urlDetails(
  crawlId: string,
  url: string,
  limits: { inlinks?: number; outlinks?: number } = {},
): UrlDetails {
  return withCrawl(crawlId, (db) => {
    const row = db.prepare('SELECT * FROM urls WHERE url = ?').get(url) as
      | (Record<string, unknown> & { id: number; redirect_url: string | null })
      | undefined
    if (!row) {
      const alternative = url.endsWith('/') ? url.slice(0, -1) : `${url}/`
      const exists = db
        .prepare('SELECT 1 FROM urls WHERE url = ?')
        .get(alternative)
      throw new CrawlQueryError(
        exists
          ? `URL not in this crawl, but "${alternative}" is.`
          : 'URL not in this crawl (not linked from crawled pages, excluded or beyond the limits).',
        404,
      )
    }
    const id = row.id
    const issues = (
      db
        .prepare('SELECT issue_id, detail FROM issues WHERE url_id = ?')
        .all(id) as Array<{ issue_id: string; detail: string | null }>
    )
      .map((issue) => {
        const def = ISSUE_BY_ID.get(issue.issue_id)
        return {
          id: issue.issue_id,
          severity: def?.severity ?? ('notice' as Severity),
          title: def?.title ?? issue.issue_id,
          detail: issue.detail,
        }
      })
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

    const inlinkLimit = Math.min(Math.max(limits.inlinks ?? 50, 0), 500)
    const outlinkLimit = Math.min(Math.max(limits.outlinks ?? 100, 0), 1000)
    const count = (sql: string) => (db.prepare(sql).get(id) as { n: number }).n

    const chain: Array<{ url: string; status: number | null }> = []
    let current: typeof row | undefined = row
    const seen = new Set<string>()
    while (current && !seen.has(String(current.url)) && chain.length < 20) {
      seen.add(String(current.url))
      chain.push({
        url: String(current.url),
        status: (current.status_code as number | null) ?? null,
      })
      const next = current.redirect_url
      if (!next) break
      current = db.prepare('SELECT * FROM urls WHERE url = ?').get(next) as
        | typeof row
        | undefined
      if (!current) chain.push({ url: next, status: null })
    }

    const { id: _id, ...publicRow } = row
    return {
      url: publicRow,
      issues,
      inlinks: {
        total: count('SELECT COUNT(*) AS n FROM links WHERE target_id = ?'),
        items: db
          .prepare(
            `SELECT s.url AS source, l.anchor, l.nofollow FROM links l
             JOIN urls s ON s.id = l.source_id WHERE l.target_id = ? ORDER BY s.url LIMIT ?`,
          )
          .all(id, inlinkLimit) as UrlDetails['inlinks']['items'],
      },
      outlinks: {
        total: count('SELECT COUNT(*) AS n FROM links WHERE source_id = ?'),
        items: db
          .prepare(
            `SELECT t.url AS target, l.anchor, l.nofollow, t.is_internal,
                    COALESCE(t.final_status, t.status_code) AS status_code
             FROM links l JOIN urls t ON t.id = l.target_id
             WHERE l.source_id = ? ORDER BY t.is_internal DESC, t.url LIMIT ?`,
          )
          .all(id, outlinkLimit) as UrlDetails['outlinks']['items'],
      },
      hreflang: db
        .prepare(
          `SELECT h.lang, t.url AS target, t.status_code FROM hreflang h
           JOIN urls t ON t.id = h.target_id WHERE h.source_id = ? ORDER BY h.lang`,
        )
        .all(id) as UrlDetails['hreflang'],
      redirectChain: chain.length > 1 ? chain : [],
      sitemaps: (
        db
          .prepare('SELECT sitemap FROM sitemap_urls WHERE url_id = ?')
          .all(id) as Array<{ sitemap: string }>
      ).map((r) => r.sitemap),
    }
  })
}

export type ExportKind = 'issues' | 'urls' | 'links'

/** Cells starting with = + - @ are prefixed with ' so Excel/Sheets never run them. */
const CSV_OPTIONS = { escapeFormulae: true }

export function exportCsv(crawlId: string, kind: ExportKind): string {
  return withCrawl(crawlId, (db) => {
    if (kind === 'issues') {
      const rows = db
        .prepare(
          `SELECT c.severity, i.issue_id, c.title AS issue, u.url, i.detail
           FROM issues i JOIN issue_catalog c ON c.issue_id = i.issue_id
           JOIN urls u ON u.id = i.url_id
           ORDER BY CASE c.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    i.issue_id, u.url`,
        )
        .all()
      return Papa.unparse(rows as object[], CSV_OPTIONS)
    }
    if (kind === 'links') {
      const rows = db
        .prepare(
          `SELECT source, target, anchor, nofollow, target_is_internal, target_status
           FROM v_links ORDER BY source, target`,
        )
        .all()
      return Papa.unparse(rows as object[], CSV_OPTIONS)
    }
    const columns = URL_COLUMNS.map(columnSql).join(', ')
    const rows = db
      .prepare(
        `SELECT ${columns} FROM urls u ORDER BY u.is_internal DESC, u.url`,
      )
      .all()
    return Papa.unparse(rows as object[], CSV_OPTIONS)
  })
}
