/**
 * Frontend types and helpers for the Site Audit tab. The shapes mirror
 * server/crawler/queries.ts and server/crawler/engine.ts (kept as local
 * copies so no server module is pulled into the client bundle).
 */

export type Severity = 'error' | 'warning' | 'notice'

export type CrawlStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'

export type CrawlPhase =
  | 'starting'
  | 'crawling'
  | 'sitemaps'
  | 'externals'
  | 'analyzing'
  | 'done'

export interface SeverityCounts {
  error: number
  warning: number
  notice: number
}

export interface CrawlProgress {
  crawlId: string
  status: CrawlStatus
  startUrl: string
  fetched: number
  queued: number
  discovered: number
  failed: number
  blocked: number
  externalChecked: number
  externalQueued: number
  currentUrl: string | null
  phase: CrawlPhase
  elapsedMs: number
  issueCount?: number
  error?: string
}

export interface CrawlLogEntry {
  time: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error' | 'progress'
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

export interface IssueSummary {
  id: string
  category: string
  severity: Severity
  title: string
  description: string
  why: string
  fix: string
  count: number
  examples: Array<{ url: string; detail: string | null }>
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

export type UrlRow = Record<string, unknown>

export interface UrlQueryResult {
  total: number
  offset: number
  limit: number
  columns: string[]
  rows: UrlRow[]
}

export interface UrlDetails {
  url: UrlRow
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

/** Same defaults and limits as CRAWL_LIMITS in server/crawler/engine.ts. */
export const SITE_AUDIT_LIMITS = {
  maxUrls: { default: 500, max: 10_000 },
  maxDepth: { default: 10, max: 50 },
  concurrency: { default: 4, max: 10 },
  requestsPerSecond: { default: 5, max: 20 },
} as const

export const SEVERITIES: Severity[] = ['error', 'warning', 'notice']

export const SEVERITY_LABELS: Record<Severity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  notice: 'Notices',
}

/** Keys of URL_FILTERS in server/crawler/queries.ts, with UI labels. */
export const URL_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All URLs' },
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'External' },
  { value: 'html', label: 'HTML pages' },
  { value: 'indexable', label: 'Indexable' },
  { value: 'non-indexable', label: 'Non-indexable' },
  { value: '2xx', label: '2xx success' },
  { value: '3xx', label: '3xx redirect' },
  { value: '4xx', label: '4xx client error' },
  { value: '5xx', label: '5xx server error' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked by robots.txt' },
  { value: 'not-crawled', label: 'Not crawled' },
]

/** Maps an overview status bucket to the matching URL filter. */
export const STATUS_BUCKET_FILTER: Record<string, string> = {
  '2xx': '2xx',
  '3xx': '3xx',
  '4xx': '4xx',
  '5xx': '5xx',
  failed: 'failed',
  blocked: 'blocked',
  'not crawled': 'not-crawled',
}

export const PHASE_LABELS: Record<CrawlPhase, string> = {
  starting: 'Starting',
  crawling: 'Crawling',
  sitemaps: 'Reading sitemaps',
  externals: 'Checking external links',
  analyzing: 'Analyzing',
  done: 'Done',
}

export const CRAWL_STATE_LABELS: Record<string, string> = {
  fetched: 'Fetched',
  failed: 'Failed',
  blocked_robots: 'Blocked (robots)',
  blocked_target: 'Blocked target',
  skipped_limit: 'Not crawled (limit)',
  excluded: 'Excluded',
  pending: 'Pending',
  not_checked: 'Not checked',
}

export function crawlStateLabel(state: unknown): string {
  const key = String(state ?? '')
  return CRAWL_STATE_LABELS[key] ?? (key || '-')
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${rest}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function crawlDurationMs(crawl: CrawlSummary): number | null {
  if (crawl.status === 'running' && crawl.progress)
    return crawl.progress.elapsedMs
  if (!crawl.startedAt || !crawl.finishedAt) return null
  return Date.parse(crawl.finishedAt) - Date.parse(crawl.startedAt)
}

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value)
}

/** "https://example.com/a/b" → "example.com/a/b" for compact lists. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

/** Error text from a $fetch / h3 error, falling back to the generic message. */
export function apiErrorMessage(error: unknown, fallback = 'Request failed') {
  const e = error as {
    data?: { message?: string; statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return (
    e?.data?.message ||
    e?.data?.statusMessage ||
    e?.statusMessage ||
    e?.message ||
    fallback
  )
}
