import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type FixtureSite, startFixtureSite } from './fixtures/site'

/**
 * Golden test: crawls the fixture site and compares every finding with the
 * expected issue → URL mapping. A new or changed check must update this list
 * deliberately (spec-first, like the clean-room approach in ADR-011/012).
 */

const EXPECTED_ISSUES: Record<string, string[]> = {
  'response.client-error': ['/broken', '/gone'],
  'response.server-error': ['/error'],
  'response.slow': ['/slow'],
  'links.broken-internal': ['/'],
  'links.broken-external': ['EXT/ext-404'],
  'links.to-redirect': ['/'],
  'links.orphan': ['/orphan'],
  'links.dead-end': ['/dead-end'],
  'links.deep': ['/deep-5'],
  'links.internal-nofollow': ['/'],
  'redirect.chain': ['/redirect-1'],
  'redirect.loop': ['/loop-1', '/loop-2'],
  'redirect.temporary': ['/temp'],
  'redirect.meta-refresh': ['/meta-refresh'],
  'canonical.missing': ['/no-canonical'],
  'canonical.multiple': ['/multi'],
  'canonical.relative': ['/relative-canonical'],
  'canonical.non-indexable-target': ['/canon-to-404'],
  'canonical.canonicalised': ['/canon-to-404'],
  'indexability.noindex': ['/noindex', '/x-noindex-conflict'],
  'indexability.blocked-by-robots': ['/private/secret'],
  'indexability.conflicting-signals': ['/x-noindex-conflict'],
  'sitemap.non-indexable': ['/noindex', '/redirect-1'],
  'hreflang.missing-return': ['/de/'],
  'hreflang.non-indexable-target': ['/de/'],
  'hreflang.invalid-code': ['/de/'],
  'title.missing': ['/no-title'],
  'title.duplicate': ['/dup-1', '/dup-2'],
  'title.multiple': ['/multi'],
  'title.too-long': ['/long-title'],
  'title.too-short': ['/short-title'],
  'meta-description.missing': ['/no-title'],
  'meta-description.duplicate': ['/dup-1', '/dup-2'],
  'meta-description.too-long': ['/long-title'],
  'h1.missing': ['/no-title'],
  'h1.multiple': ['/multi'],
  'content.exact-duplicate': ['/dup-1', '/dup-2'],
  'content.near-duplicate': ['/near-1', '/near-2'],
  'content.thin': ['/thin'],
  'images.missing-alt': ['/image-page'],
}

let site: FixtureSite
let outputDir: string
let crawlId: string
let db: DatabaseSync
let progressStatus: string
const warnings: string[] = []
const onWarning = (warning: Error) => warnings.push(warning.name)

function path(url: string): string {
  if (url.startsWith(site.externalBase)) {
    return `EXT${url.slice(site.externalBase.length)}`
  }
  return url.startsWith(site.base) ? url.slice(site.base.length) : url
}

beforeAll(async () => {
  process.on('warning', onWarning)
  outputDir = mkdtempSync(join(tmpdir(), 'url-tools-golden-'))
  process.env.OUTPUT_DIR = outputDir
  process.env.URL_TOOLS_ALLOW_LOCALHOST = '1'
  site = await startFixtureSite()
  const engine = await import('../engine')
  const store = await import('../store')
  const job = engine.startCrawl({
    startUrl: `${site.base}/`,
    requestsPerSecond: 20,
    concurrency: 4,
    source: 'api',
  })
  crawlId = job.crawlId
  const progress = await job.done
  progressStatus = progress.status
  db = store.openCrawlReadOnly(crawlId)
}, 60_000)

afterAll(async () => {
  process.off('warning', onWarning)
  db?.close()
  const { destroyAgents } = await import('../http-client')
  destroyAgents()
  await site?.close()
  rmSync(outputDir, { recursive: true, force: true })
  delete process.env.URL_TOOLS_ALLOW_LOCALHOST
})

describe('site crawl against the golden fixture site', () => {
  it('completes', () => {
    expect(progressStatus).toBe('completed')
  })

  it('finds exactly the expected issues', () => {
    const rows = db
      .prepare('SELECT issue_id, url FROM v_issues ORDER BY issue_id, url')
      .all() as Array<{ issue_id: string; url: string }>
    const actual: Record<string, string[]> = {}
    for (const row of rows) {
      if (row.issue_id === 'security.http-page') continue
      const list = actual[row.issue_id] ?? []
      list.push(path(row.url))
      actual[row.issue_id] = list
    }
    for (const list of Object.values(actual)) list.sort()
    const expected = Object.fromEntries(
      Object.entries(EXPECTED_ISSUES).map(([id, urls]) => [
        id,
        [...urls].sort(),
      ]),
    )
    expect(actual).toEqual(expected)
  })

  it('flags every HTML page as served over HTTP (fixture runs without TLS)', () => {
    const pages = db
      .prepare(
        `SELECT COUNT(*) AS n FROM urls WHERE is_internal = 1 AND crawl_state = 'fetched'
         AND status_code BETWEEN 200 AND 299 AND is_html = 1`,
      )
      .get() as { n: number }
    const flagged = db
      .prepare(
        `SELECT COUNT(*) AS n FROM issues WHERE issue_id = 'security.http-page'`,
      )
      .get() as { n: number }
    expect(pages.n).toBe(30)
    expect(flagged.n).toBe(pages.n)
  })

  it('records click depth, discovery source and robots blocking', () => {
    const row = (p: string) =>
      db
        .prepare(
          'SELECT depth, found_via, crawl_state, status_code FROM urls WHERE url = ?',
        )
        .get(`${site.base}${p}`) as {
        depth: number | null
        found_via: string
        crawl_state: string
        status_code: number | null
      }
    expect(row('/').depth).toBe(0)
    expect(row('/deep-5').depth).toBe(5)
    expect(row('/en/').found_via).toBe('hreflang')
    expect(row('/gone').found_via).toBe('canonical')
    expect(row('/redirect-2').found_via).toBe('redirect')
    expect(row('/orphan')).toMatchObject({ found_via: 'sitemap', depth: null })
    expect(row('/private/secret').crawl_state).toBe('blocked_robots')
    expect(site.requests).not.toContain('/private/secret')
    expect(site.requests).toContain('/robots.txt')
  })

  it('resolves redirect chains to their final target', () => {
    const r = db
      .prepare(
        'SELECT final_url, final_status, redirect_hops FROM urls WHERE url = ?',
      )
      .get(`${site.base}/redirect-1`) as {
      final_url: string
      final_status: number
      redirect_hops: number
    }
    expect(r).toEqual({
      final_url: `${site.base}/about`,
      final_status: 200,
      redirect_hops: 2,
    })
  })

  it('checks external links without crawling them', () => {
    const rows = db
      .prepare(
        'SELECT url, status_code, crawl_state, is_internal FROM urls WHERE is_internal = 0 ORDER BY url',
      )
      .all() as Array<{ url: string; status_code: number; crawl_state: string }>
    expect(
      rows.map((r) => [path(r.url), r.status_code, r.crawl_state]),
    ).toEqual([
      ['EXT/ext-404', 404, 'fetched'],
      ['EXT/ext-ok', 200, 'fetched'],
    ])
  })

  it('does not leak abort listeners during the crawl', () => {
    expect(warnings).not.toContain('MaxListenersExceededWarning')
  })

  it('neutralises spreadsheet formulas in CSV exports', async () => {
    const { exportCsv } = await import('../queries')
    const csv = exportCsv(crawlId, 'urls')
    expect(csv).toContain(`"'=HYPERLINK(`)
    expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m)
  })

  it('stores the issue catalog inside the crawl file', () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM issue_catalog').get() as {
      n: number
    }
    expect(n.n).toBeGreaterThanOrEqual(45)
    const meta = db
      .prepare("SELECT value FROM meta WHERE key = 'status'")
      .get() as {
      value: string
    }
    expect(meta.value).toBe('completed')
  })
})
