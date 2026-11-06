import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { assertWithinOutput, OUTPUT_ROOT } from '../utils/path-guard'

/**
 * One SQLite file per crawl: `<OUTPUT_DIR>/crawls/<crawl-id>.sqlite`.
 * The schema is documented in docs/data-model.md ("Crawl file") and is
 * versioned via `PRAGMA user_version`. See ADR-011.
 */

export const SCHEMA_VERSION = 1
/** 'UTLS' — lets `file`/tools recognise a url-tools crawl file. */
export const APPLICATION_ID = 0x55544c53
export const TOOL_VERSION = '2.0'

const CRAWL_ID_PATTERN =
  /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z0-9.-]{1,100}(?:_\d{1,3})?$/

export type CrawlStatus =
  | 'running'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'

export type FoundVia =
  | 'seed'
  | 'link'
  | 'redirect'
  | 'canonical'
  | 'hreflang'
  | 'sitemap'

export type CrawlState =
  | 'pending'
  | 'fetched'
  | 'failed'
  | 'blocked_robots'
  | 'blocked_target'
  | 'excluded'
  | 'skipped_limit'
  | 'not_checked'

const SCHEMA_SQL = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE urls (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  is_internal INTEGER NOT NULL DEFAULT 0,
  found_via TEXT NOT NULL,
  depth INTEGER,
  crawl_state TEXT NOT NULL DEFAULT 'pending',
  status_code INTEGER,
  error TEXT,
  content_type TEXT,
  is_html INTEGER NOT NULL DEFAULT 0,
  redirect_url TEXT,
  final_url TEXT,
  final_status INTEGER,
  redirect_hops INTEGER NOT NULL DEFAULT 0,
  response_ms INTEGER,
  size_bytes INTEGER,
  title TEXT,
  title_length INTEGER,
  title_count INTEGER,
  meta_description TEXT,
  meta_description_length INTEGER,
  meta_description_count INTEGER,
  h1 TEXT,
  h1_count INTEGER,
  h2_count INTEGER,
  meta_robots TEXT,
  x_robots_tag TEXT,
  noindex INTEGER NOT NULL DEFAULT 0,
  nofollow INTEGER NOT NULL DEFAULT 0,
  canonical_url TEXT,
  canonical_count INTEGER NOT NULL DEFAULT 0,
  canonical_relative INTEGER NOT NULL DEFAULT 0,
  lang TEXT,
  meta_refresh_url TEXT,
  word_count INTEGER,
  content_hash TEXT,
  simhash TEXT,
  images_total INTEGER,
  images_missing_alt INTEGER,
  insecure_resources INTEGER,
  in_sitemap INTEGER NOT NULL DEFAULT 0,
  indexable INTEGER,
  indexability_reason TEXT,
  inlinks INTEGER NOT NULL DEFAULT 0,
  outlinks INTEGER NOT NULL DEFAULT 0,
  external_outlinks INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE links (
  source_id INTEGER NOT NULL REFERENCES urls(id),
  target_id INTEGER NOT NULL REFERENCES urls(id),
  anchor TEXT,
  rel TEXT,
  nofollow INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, target_id)
) WITHOUT ROWID;
CREATE INDEX idx_links_target ON links(target_id);
CREATE TABLE hreflang (
  source_id INTEGER NOT NULL REFERENCES urls(id),
  lang TEXT NOT NULL,
  target_id INTEGER NOT NULL REFERENCES urls(id),
  PRIMARY KEY (source_id, lang, target_id)
) WITHOUT ROWID;
CREATE TABLE sitemap_urls (
  url_id INTEGER NOT NULL REFERENCES urls(id),
  sitemap TEXT NOT NULL,
  PRIMARY KEY (url_id, sitemap)
) WITHOUT ROWID;
CREATE TABLE issue_catalog (
  issue_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  why TEXT NOT NULL,
  fix TEXT NOT NULL
);
CREATE TABLE issues (
  issue_id TEXT NOT NULL REFERENCES issue_catalog(issue_id),
  url_id INTEGER NOT NULL REFERENCES urls(id),
  detail TEXT,
  PRIMARY KEY (issue_id, url_id)
) WITHOUT ROWID;
CREATE INDEX idx_issues_url ON issues(url_id);
CREATE VIEW v_issues AS
  SELECT i.issue_id, c.severity, c.category, c.title, u.url, i.detail
  FROM issues i
  JOIN issue_catalog c ON c.issue_id = i.issue_id
  JOIN urls u ON u.id = i.url_id;
CREATE VIEW v_links AS
  SELECT s.url AS source, t.url AS target, l.anchor, l.rel, l.nofollow,
         t.is_internal AS target_is_internal, t.status_code AS target_status
  FROM links l
  JOIN urls s ON s.id = l.source_id
  JOIN urls t ON t.id = l.target_id;
`

export function crawlsDir(): string {
  return join(OUTPUT_ROOT, 'crawls')
}

export function isValidCrawlId(id: unknown): id is string {
  return typeof id === 'string' && CRAWL_ID_PATTERN.test(id)
}

export function crawlFilePath(id: string): string {
  if (!isValidCrawlId(id)) throw new Error('Invalid crawl id')
  return assertWithinOutput(join(crawlsDir(), `${id}.sqlite`))
}

export function crawlExists(id: string): boolean {
  return isValidCrawlId(id) && existsSync(crawlFilePath(id))
}

function timestampForId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export function newCrawlId(startUrl: string, now = new Date()): string {
  const host = new URL(startUrl).hostname
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .slice(0, 100)
  const base = `${timestampForId(now)}_${host || 'site'}`
  let id = base
  for (let n = 2; crawlExists(id) && n < 1000; n++) id = `${base}_${n}`
  return id
}

/** Crawl ids present on disk, newest first (ids start with a timestamp). */
export function listCrawlIds(): string[] {
  const dir = crawlsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => name.slice(0, -'.sqlite'.length))
    .filter(isValidCrawlId)
    .sort()
    .reverse()
}

export function crawlFileSize(id: string): number {
  try {
    return statSync(crawlFilePath(id)).size
  } catch {
    return 0
  }
}

/** Opens a crawl file for reading. Callers must close it. */
export function openCrawlReadOnly(id: string): DatabaseSync {
  const path = crawlFilePath(id)
  if (!existsSync(path)) throw new Error(`Crawl not found: ${id}`)
  return new DatabaseSync(path, { readOnly: true })
}

export function readMeta(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta').all() as Array<{
    key: string
    value: string
  }>
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export interface ResponseRecord {
  statusCode: number
  contentType: string | null
  isHtml: boolean
  redirectUrl: string | null
  responseMs: number
  sizeBytes: number
  xRobotsTag: string | null
}

export interface PageRecord {
  title: string | null
  titleCount: number
  metaDescription: string | null
  metaDescriptionCount: number
  h1: string | null
  h1Count: number
  h2Count: number
  metaRobots: string | null
  noindex: boolean
  nofollow: boolean
  canonicalUrl: string | null
  canonicalCount: number
  canonicalRelative: boolean
  lang: string | null
  metaRefreshUrl: string | null
  wordCount: number
  contentHash: string
  simhash: string
  imagesTotal: number
  imagesMissingAlt: number
  insecureResources: number
}

export interface ExternalRecord {
  state: CrawlState
  statusCode: number | null
  finalUrl: string | null
  finalStatus: number | null
  redirectHops: number
  error: string | null
}

const bool = (value: boolean) => (value ? 1 : 0)

/** Write access during a crawl. Single-threaded use from the crawl engine. */
export class CrawlWriter {
  readonly db: DatabaseSync
  private readonly ids = new Map<string, number>()
  private readonly stmt: Record<string, StatementSync>

  private constructor(readonly path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA_SQL)
    const prepare = (sql: string) => this.db.prepare(sql)
    this.stmt = {
      insertUrl: prepare(
        'INSERT INTO urls (url, is_internal, found_via, depth) VALUES (?, ?, ?, ?) RETURNING id',
      ),
      setMeta: prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ),
      markState: prepare(
        'UPDATE urls SET crawl_state = ?, error = ? WHERE id = ?',
      ),
      response: prepare(
        `UPDATE urls SET crawl_state = 'fetched', error = NULL, status_code = ?, content_type = ?,
           is_html = ?, redirect_url = ?, response_ms = ?, size_bytes = ?, x_robots_tag = ?
         WHERE id = ?`,
      ),
      page: prepare(
        `UPDATE urls SET title = ?, title_length = ?, title_count = ?, meta_description = ?,
           meta_description_length = ?, meta_description_count = ?, h1 = ?, h1_count = ?,
           h2_count = ?, meta_robots = ?, noindex = ?, nofollow = ?, canonical_url = ?,
           canonical_count = ?, canonical_relative = ?, lang = ?, meta_refresh_url = ?,
           word_count = ?, content_hash = ?, simhash = ?, images_total = ?,
           images_missing_alt = ?, insecure_resources = ?
         WHERE id = ?`,
      ),
      external: prepare(
        `UPDATE urls SET crawl_state = ?, status_code = ?, final_url = ?, final_status = ?,
           redirect_hops = ?, error = ?
         WHERE id = ?`,
      ),
      link: prepare(
        'INSERT OR IGNORE INTO links (source_id, target_id, anchor, rel, nofollow) VALUES (?, ?, ?, ?, ?)',
      ),
      hreflang: prepare(
        'INSERT OR IGNORE INTO hreflang (source_id, lang, target_id) VALUES (?, ?, ?)',
      ),
      sitemapUrl: prepare(
        'INSERT OR IGNORE INTO sitemap_urls (url_id, sitemap) VALUES (?, ?)',
      ),
    }
  }

  static create(id: string): CrawlWriter {
    mkdirSync(crawlsDir(), { recursive: true })
    const path = crawlFilePath(id)
    if (existsSync(path)) throw new Error(`Crawl file already exists: ${id}`)
    return new CrawlWriter(path)
  }

  setMeta(key: string, value: string | number | object): void {
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'number'
          ? String(value)
          : JSON.stringify(value)
    this.stmt.setMeta?.run(key, text)
  }

  idOf(url: string): number | undefined {
    return this.ids.get(url)
  }

  /** Returns the id and whether the URL was new. */
  ensureUrl(
    url: string,
    isInternal: boolean,
    foundVia: FoundVia,
    depth: number | null,
  ): { id: number; created: boolean } {
    const existing = this.ids.get(url)
    if (existing !== undefined) return { id: existing, created: false }
    const row = this.stmt.insertUrl?.get(
      url,
      bool(isInternal),
      foundVia,
      depth,
    ) as { id: number }
    this.ids.set(url, row.id)
    return { id: row.id, created: true }
  }

  markState(id: number, state: CrawlState, error: string | null = null) {
    this.stmt.markState?.run(state, error, id)
  }

  recordResponse(id: number, r: ResponseRecord): void {
    this.stmt.response?.run(
      r.statusCode,
      r.contentType,
      bool(r.isHtml),
      r.redirectUrl,
      r.responseMs,
      r.sizeBytes,
      r.xRobotsTag,
      id,
    )
  }

  recordPage(id: number, p: PageRecord): void {
    this.stmt.page?.run(
      p.title,
      p.title ? [...p.title].length : 0,
      p.titleCount,
      p.metaDescription,
      p.metaDescription ? [...p.metaDescription].length : 0,
      p.metaDescriptionCount,
      p.h1,
      p.h1Count,
      p.h2Count,
      p.metaRobots,
      bool(p.noindex),
      bool(p.nofollow),
      p.canonicalUrl,
      p.canonicalCount,
      bool(p.canonicalRelative),
      p.lang,
      p.metaRefreshUrl,
      p.wordCount,
      p.contentHash,
      p.simhash,
      p.imagesTotal,
      p.imagesMissingAlt,
      p.insecureResources,
      id,
    )
  }

  recordExternal(id: number, e: ExternalRecord): void {
    this.stmt.external?.run(
      e.state,
      e.statusCode,
      e.finalUrl,
      e.finalStatus,
      e.redirectHops,
      e.error,
      id,
    )
  }

  addLink(
    sourceId: number,
    targetId: number,
    anchor: string,
    rel: string,
    nofollow: boolean,
  ): void {
    this.stmt.link?.run(sourceId, targetId, anchor, rel, bool(nofollow))
  }

  addHreflang(sourceId: number, lang: string, targetId: number): void {
    this.stmt.hreflang?.run(sourceId, lang, targetId)
  }

  addSitemapUrl(urlId: number, sitemap: string): void {
    this.stmt.sitemapUrl?.run(urlId, sitemap)
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Switches back to a rollback journal so the finished crawl is one
   * self-contained file without -wal/-shm sidecars.
   */
  close(): void {
    try {
      this.db.exec('PRAGMA journal_mode = DELETE')
    } catch {
      // A reader still holds the file open; it stays in WAL mode, which is fine.
    } finally {
      this.db.close()
    }
  }
}
