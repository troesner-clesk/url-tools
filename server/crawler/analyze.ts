import type { DatabaseSync } from 'node:sqlite'
import { ISSUE_CATALOG } from './catalog'
import { hammingDistance, parseSimhash, type SimhashParts } from './content'

/**
 * Site-wide analysis after (or when stopping) a crawl: derives redirect
 * chains, link counts and indexability, then evaluates every check of the
 * issue catalog into the `issues` table. Pure SQL/JS over the crawl file, so
 * it can be re-run on old crawl files when checks improve.
 */

/** Internal HTML page that answered 2xx. */
const PAGE = `is_internal = 1 AND crawl_state = 'fetched' AND status_code BETWEEN 200 AND 299 AND is_html = 1`
/** PAGE that is indexable (not noindex, not canonicalised elsewhere). */
const INDEXABLE = `${PAGE} AND indexable = 1`

const NEAR_DUPLICATE_MAX_DISTANCE = 3
const NEAR_DUPLICATE_MIN_WORDS = 50
const NEAR_DUPLICATE_MAX_PAGES = 10_000

// ISO 639-1 (plus the legacy codes iw/in/ji that Google still accepts)
const LANGUAGES = new Set(
  'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu iw in ji'.split(
    ' ',
  ),
)
// ISO 3166-1 alpha-2 (plus XK); "UK" is deliberately missing, it is "GB".
const REGIONS = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(
    ' ',
  ),
)

export function isValidHreflang(code: string): boolean {
  const value = code.trim()
  if (value.toLowerCase() === 'x-default') return true
  const match = value.match(
    /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?$/i,
  )
  if (!match) return false
  const [, language = '', , region] = match
  if (language.length === 2 && !LANGUAGES.has(language.toLowerCase())) {
    return false
  }
  if (region && /^[a-z]{2}$/i.test(region)) {
    return REGIONS.has(region.toUpperCase())
  }
  return true
}

export interface AnalyzeOptions {
  startUrlId: number
  /** Whether sitemap discovery ran (so "no sitemap" is a finding). */
  sitemapsChecked: boolean
  sitemapUrlCount: number
}

interface UrlRow {
  id: number
  url: string
  status_code: number | null
  redirect_url: string | null
  crawl_state: string
  is_internal: number
  final_url: string | null
  final_status: number | null
  redirect_hops: number
}

function isRedirect(row: UrlRow): boolean {
  return (
    row.crawl_state === 'fetched' &&
    row.status_code !== null &&
    row.status_code >= 300 &&
    row.status_code < 400 &&
    Boolean(row.redirect_url)
  )
}

function shortList(items: string[], max = 3): string {
  const shown = items.slice(0, max).join(', ')
  return items.length > max ? `${shown} (+${items.length - max} more)` : shown
}

export function analyzeCrawl(
  db: DatabaseSync,
  options: AnalyzeOptions,
): Record<string, number> {
  db.exec('BEGIN')
  try {
    const loops = resolveRedirects(db)
    deriveColumns(db)
    writeCatalog(db)
    runChecks(db, options, loops)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const counts = db
    .prepare('SELECT issue_id, COUNT(*) AS n FROM issues GROUP BY issue_id')
    .all() as Array<{ issue_id: string; n: number }>
  return Object.fromEntries(counts.map((row) => [row.issue_id, row.n]))
}

/** Follows internal redirect hops through the crawled URLs. */
function resolveRedirects(db: DatabaseSync): Map<number, string> {
  const rows = db
    .prepare(
      'SELECT id, url, status_code, redirect_url, crawl_state, is_internal, final_url, final_status, redirect_hops FROM urls',
    )
    .all() as unknown as UrlRow[]
  const byUrl = new Map(rows.map((row) => [row.url, row]))
  const update = db.prepare(
    'UPDATE urls SET final_url = ?, final_status = ?, redirect_hops = ? WHERE id = ?',
  )
  const chainDetails = new Map<number, string>()
  const loops = new Map<number, string>()

  for (const row of rows) {
    if (row.is_internal !== 1 || row.crawl_state !== 'fetched') continue
    if (!isRedirect(row)) {
      update.run(row.url, row.status_code, 0, row.id)
      continue
    }
    const chain: UrlRow[] = [row]
    const seen = new Set([row.url])
    let current = row
    let hops = 0
    let finalUrl: string | null = null
    let finalStatus: number | null = null
    let loop = false
    while (true) {
      const next = current.redirect_url as string
      hops++
      if (seen.has(next) || hops > 20) {
        loop = true
        finalUrl = next
        break
      }
      seen.add(next)
      const target = byUrl.get(next)
      if (target?.crawl_state !== 'fetched') {
        finalUrl = next
        break
      }
      chain.push(target)
      if (target.is_internal !== 1) {
        finalUrl = target.final_url ?? target.url
        finalStatus = target.final_status ?? target.status_code
        hops += target.redirect_hops
        break
      }
      if (isRedirect(target)) {
        current = target
        continue
      }
      finalUrl = target.url
      finalStatus = target.status_code
      break
    }
    update.run(finalUrl, loop ? null : finalStatus, hops, row.id)
    const statuses = chain.map((step) => step.status_code ?? '?').join(' → ')
    const path = [...chain.map((step) => step.url), loop ? finalUrl : null]
      .filter(Boolean)
      .join(' → ')
    const detail = `${statuses}${loop ? ' → (loop)' : ''}: ${path}`
    chainDetails.set(row.id, detail)
    if (loop) loops.set(row.id, detail)
  }

  // Keep chain details for the redirect.chain check in a temp table.
  db.exec(
    'CREATE TEMP TABLE IF NOT EXISTS redirect_details (url_id INTEGER PRIMARY KEY, detail TEXT, is_loop INTEGER)',
  )
  db.exec('DELETE FROM redirect_details')
  const insert = db.prepare(
    'INSERT INTO redirect_details (url_id, detail, is_loop) VALUES (?, ?, ?)',
  )
  for (const [id, detail] of chainDetails) {
    insert.run(id, detail, loops.has(id) ? 1 : 0)
  }
  return loops
}

function deriveColumns(db: DatabaseSync): void {
  db.exec(`
    UPDATE urls SET
      inlinks = (SELECT COUNT(*) FROM links l JOIN urls s ON s.id = l.source_id
                 WHERE l.target_id = urls.id AND s.is_internal = 1 AND l.source_id <> urls.id),
      outlinks = (SELECT COUNT(*) FROM links l JOIN urls t ON t.id = l.target_id
                  WHERE l.source_id = urls.id AND t.is_internal = 1 AND l.target_id <> urls.id),
      external_outlinks = (SELECT COUNT(*) FROM links l JOIN urls t ON t.id = l.target_id
                           WHERE l.source_id = urls.id AND t.is_internal = 0),
      in_sitemap = EXISTS (SELECT 1 FROM sitemap_urls s WHERE s.url_id = urls.id);

    UPDATE urls SET indexable = NULL, indexability_reason = NULL WHERE is_internal = 0;

    UPDATE urls SET
      indexable = CASE
        WHEN crawl_state IN ('blocked_robots', 'failed', 'blocked_target') THEN 0
        WHEN crawl_state <> 'fetched' THEN NULL
        WHEN status_code NOT BETWEEN 200 AND 299 THEN 0
        WHEN is_html = 0 THEN NULL
        WHEN noindex = 1 THEN 0
        WHEN canonical_url IS NOT NULL AND canonical_url <> url THEN 0
        ELSE 1 END,
      indexability_reason = CASE
        WHEN crawl_state = 'blocked_robots' THEN 'blocked_robots'
        WHEN crawl_state IN ('failed', 'blocked_target') THEN 'fetch_failed'
        WHEN crawl_state <> 'fetched' THEN NULL
        WHEN status_code BETWEEN 300 AND 399 THEN 'redirect'
        WHEN status_code BETWEEN 400 AND 499 THEN 'client_error'
        WHEN status_code >= 500 THEN 'server_error'
        WHEN status_code NOT BETWEEN 200 AND 299 THEN 'other_status'
        WHEN is_html = 0 THEN NULL
        WHEN noindex = 1 THEN 'noindex'
        WHEN canonical_url IS NOT NULL AND canonical_url <> url THEN 'canonicalised'
        ELSE NULL END
    WHERE is_internal = 1;
  `)
}

function writeCatalog(db: DatabaseSync): void {
  db.exec('DELETE FROM issues; DELETE FROM issue_catalog;')
  const insert = db.prepare(
    'INSERT INTO issue_catalog (issue_id, category, severity, title, description, why, fix) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const issue of ISSUE_CATALOG) {
    insert.run(
      issue.id,
      issue.category,
      issue.severity,
      issue.title,
      issue.description,
      issue.why,
      issue.fix,
    )
  }
}

function runChecks(
  db: DatabaseSync,
  options: AnalyzeOptions,
  loops: Map<number, string>,
): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO issues (issue_id, url_id, detail) VALUES (?, ?, ?)',
  )
  const add = (issueId: string, urlId: number, detail: string | null = null) =>
    insert.run(issueId, urlId, detail)

  /** SQL returning `id` and optional `detail`. */
  const sql = (issueId: string, query: string) => {
    const rows = db.prepare(query).all() as Array<{
      id: number
      detail?: string | null
    }>
    for (const row of rows) add(issueId, row.id, row.detail ?? null)
  }

  /** SQL returning `id` (the page to flag) and `item` (one finding). */
  const grouped = (
    issueId: string,
    query: string,
    label: (count: number) => string,
  ) => {
    const rows = db.prepare(query).all() as Array<{ id: number; item: string }>
    const byPage = new Map<number, string[]>()
    for (const row of rows) {
      const list = byPage.get(row.id) ?? []
      list.push(row.item)
      byPage.set(row.id, list)
    }
    for (const [id, items] of byPage) {
      add(issueId, id, `${label(items.length)}: ${shortList(items)}`)
    }
  }
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`

  // Response codes
  sql(
    'response.client-error',
    `SELECT id, 'HTTP ' || status_code AS detail FROM urls
     WHERE is_internal = 1 AND crawl_state = 'fetched' AND status_code BETWEEN 400 AND 499`,
  )
  sql(
    'response.server-error',
    `SELECT id, 'HTTP ' || status_code AS detail FROM urls
     WHERE is_internal = 1 AND crawl_state = 'fetched' AND status_code >= 500`,
  )
  sql(
    'response.fetch-failed',
    `SELECT id, error AS detail FROM urls
     WHERE is_internal = 1 AND crawl_state IN ('failed', 'blocked_target')`,
  )
  sql(
    'response.slow',
    `SELECT id, response_ms || ' ms' AS detail FROM urls WHERE ${PAGE} AND response_ms > 1000`,
  )

  // Links
  grouped(
    'links.broken-internal',
    `SELECT l.source_id AS id, t.url || ' (' || COALESCE('HTTP ' || t.status_code, t.error, 'failed') || ')' AS item
     FROM links l JOIN urls s ON s.id = l.source_id JOIN urls t ON t.id = l.target_id
     WHERE s.is_internal = 1 AND t.is_internal = 1
       AND ((t.crawl_state = 'fetched' AND t.status_code >= 400) OR t.crawl_state = 'failed')
     ORDER BY t.url`,
    (n) => plural(n, 'broken link'),
  )
  sql(
    'links.broken-external',
    `SELECT id,
       CASE WHEN crawl_state = 'failed' THEN COALESCE(error, 'failed')
            ELSE 'HTTP ' || final_status END
       || ' · linked from ' || inlinks || CASE WHEN inlinks = 1 THEN ' page' ELSE ' pages' END AS detail
     FROM urls
     WHERE is_internal = 0
       AND (crawl_state = 'failed' OR (crawl_state = 'fetched' AND final_status >= 400))`,
  )
  grouped(
    'links.to-redirect',
    `SELECT l.source_id AS id, t.url || ' (' || t.status_code || ')' AS item
     FROM links l JOIN urls s ON s.id = l.source_id JOIN urls t ON t.id = l.target_id
     WHERE s.is_internal = 1 AND t.is_internal = 1 AND t.crawl_state = 'fetched'
       AND t.status_code BETWEEN 300 AND 399
     ORDER BY t.url`,
    (n) => `${plural(n, 'link')} to redirects`,
  )
  sql(
    'links.orphan',
    `SELECT id FROM urls WHERE ${PAGE} AND in_sitemap = 1 AND inlinks = 0 AND id <> ${options.startUrlId}`,
  )
  sql(
    'links.dead-end',
    `SELECT id FROM urls WHERE ${INDEXABLE} AND outlinks = 0`,
  )
  sql(
    'links.deep',
    `SELECT id, depth || ' clicks' AS detail FROM urls WHERE ${INDEXABLE} AND depth >= 5`,
  )
  grouped(
    'links.internal-nofollow',
    `SELECT l.source_id AS id, t.url AS item
     FROM links l JOIN urls s ON s.id = l.source_id JOIN urls t ON t.id = l.target_id
     WHERE s.is_internal = 1 AND t.is_internal = 1 AND l.nofollow = 1
     ORDER BY t.url`,
    (n) => plural(n, 'nofollow link'),
  )

  // Redirects
  sql(
    'redirect.chain',
    `SELECT u.id, d.detail FROM urls u JOIN redirect_details d ON d.url_id = u.id
     WHERE u.is_internal = 1 AND u.redirect_hops >= 2 AND d.is_loop = 0`,
  )
  for (const [id, detail] of loops) add('redirect.loop', id, detail)
  sql(
    'redirect.temporary',
    `SELECT id, 'HTTP ' || status_code || ' → ' || COALESCE(redirect_url, '?') AS detail FROM urls
     WHERE is_internal = 1 AND crawl_state = 'fetched' AND status_code IN (302, 303, 307)`,
  )
  sql(
    'redirect.meta-refresh',
    `SELECT id, meta_refresh_url AS detail FROM urls WHERE ${PAGE} AND meta_refresh_url IS NOT NULL`,
  )

  // Canonicals
  sql(
    'canonical.missing',
    `SELECT id FROM urls WHERE ${PAGE} AND noindex = 0 AND canonical_count = 0`,
  )
  sql(
    'canonical.multiple',
    `SELECT id, canonical_count || ' different canonical URLs' AS detail FROM urls
     WHERE ${PAGE} AND canonical_count > 1`,
  )
  sql(
    'canonical.relative',
    `SELECT id, canonical_url AS detail FROM urls WHERE ${PAGE} AND canonical_relative = 1`,
  )
  sql(
    'canonical.non-indexable-target',
    `SELECT u.id, '→ ' || u.canonical_url || ' (' ||
       CASE
         WHEN t.crawl_state = 'blocked_robots' THEN 'blocked by robots.txt'
         WHEN t.crawl_state IN ('failed', 'blocked_target') THEN COALESCE(t.error, 'fetch failed')
         WHEN t.status_code BETWEEN 300 AND 399 THEN 'redirects, HTTP ' || t.status_code
         WHEN t.status_code NOT BETWEEN 200 AND 299 THEN 'HTTP ' || t.status_code
         ELSE 'noindex' END || ')' AS detail
     FROM urls u JOIN urls t ON t.url = u.canonical_url
     WHERE u.is_internal = 1 AND u.crawl_state = 'fetched' AND u.status_code BETWEEN 200 AND 299
       AND u.is_html = 1 AND u.canonical_url <> u.url
       AND (t.crawl_state IN ('failed', 'blocked_robots', 'blocked_target')
            OR (t.crawl_state = 'fetched' AND (t.status_code NOT BETWEEN 200 AND 299 OR t.noindex = 1)))`,
  )
  sql(
    'canonical.canonicalised',
    `SELECT id, '→ ' || canonical_url AS detail FROM urls
     WHERE ${PAGE} AND indexability_reason = 'canonicalised'`,
  )

  // Indexability
  sql(
    'indexability.noindex',
    `SELECT id, CASE WHEN x_robots_tag LIKE '%noindex%' OR x_robots_tag LIKE '%none%'
                     THEN 'X-Robots-Tag: ' || x_robots_tag
                     ELSE 'meta robots: ' || COALESCE(meta_robots, '') END AS detail
     FROM urls WHERE ${PAGE} AND noindex = 1`,
  )
  sql(
    'indexability.blocked-by-robots',
    `SELECT id, 'linked from ' || inlinks || CASE WHEN inlinks = 1 THEN ' page' ELSE ' pages' END AS detail
     FROM urls WHERE is_internal = 1 AND crawl_state = 'blocked_robots'`,
  )
  sql(
    'indexability.conflicting-signals',
    `SELECT id, 'noindex + canonical → ' || canonical_url AS detail FROM urls
     WHERE ${PAGE} AND noindex = 1 AND canonical_url IS NOT NULL AND canonical_url <> url`,
  )

  // Sitemaps
  sql(
    'sitemap.non-indexable',
    `SELECT id, COALESCE(indexability_reason, 'HTTP ' || status_code) AS detail FROM urls
     WHERE is_internal = 1 AND in_sitemap = 1
       AND (crawl_state IN ('failed', 'blocked_robots', 'blocked_target')
            OR (crawl_state = 'fetched' AND (status_code NOT BETWEEN 200 AND 299 OR indexable = 0)))`,
  )
  if (options.sitemapsChecked && options.sitemapUrlCount === 0) {
    add(
      'sitemap.not-found',
      options.startUrlId,
      'Checked the Sitemap lines in robots.txt and /sitemap.xml',
    )
  }

  // Hreflang
  grouped(
    'hreflang.missing-return',
    `SELECT h.source_id AS id, t.url || ' (' || h.lang || ')' AS item
     FROM hreflang h JOIN urls t ON t.id = h.target_id
     WHERE h.source_id <> h.target_id AND t.is_internal = 1 AND t.crawl_state = 'fetched'
       AND t.status_code BETWEEN 200 AND 299 AND t.is_html = 1
       AND NOT EXISTS (SELECT 1 FROM hreflang r WHERE r.source_id = h.target_id AND r.target_id = h.source_id)
     ORDER BY t.url`,
    (n) => `${plural(n, 'alternate')} without return link`,
  )
  grouped(
    'hreflang.non-indexable-target',
    `SELECT h.source_id AS id, t.url || ' (' || h.lang || ', ' ||
       COALESCE(t.indexability_reason, 'HTTP ' || COALESCE(t.final_status, t.status_code), t.error, t.crawl_state) || ')' AS item
     FROM hreflang h JOIN urls t ON t.id = h.target_id
     WHERE h.source_id <> h.target_id
       AND (t.crawl_state IN ('failed', 'blocked_robots', 'blocked_target')
            OR (t.crawl_state = 'fetched' AND (
                 (t.is_internal = 1 AND (t.status_code NOT BETWEEN 200 AND 299 OR t.indexable = 0))
              OR (t.is_internal = 0 AND (t.status_code NOT BETWEEN 200 AND 299)))))
     ORDER BY t.url`,
    (n) => plural(n, 'non-indexable target'),
  )
  sql(
    'hreflang.missing-self',
    `SELECT source_id AS id FROM hreflang GROUP BY source_id HAVING SUM(target_id = source_id) = 0`,
  )
  const invalid = new Map<number, string[]>()
  for (const row of db
    .prepare('SELECT DISTINCT source_id AS id, lang FROM hreflang')
    .all() as Array<{ id: number; lang: string }>) {
    if (isValidHreflang(row.lang)) continue
    const list = invalid.get(row.id) ?? []
    list.push(`"${row.lang}"`)
    invalid.set(row.id, list)
  }
  for (const [id, codes] of invalid) {
    add('hreflang.invalid-code', id, shortList(codes))
  }

  // Titles, descriptions, headings
  sql(
    'title.missing',
    `SELECT id FROM urls WHERE ${INDEXABLE} AND (title IS NULL OR title = '')`,
  )
  sql(
    'title.multiple',
    `SELECT id, title_count || ' title elements' AS detail FROM urls WHERE ${INDEXABLE} AND title_count > 1`,
  )
  sql(
    'title.too-long',
    `SELECT id, title_length || ' characters' AS detail FROM urls WHERE ${INDEXABLE} AND title_length > 60`,
  )
  sql(
    'title.too-short',
    `SELECT id, title_length || ' characters' AS detail FROM urls
     WHERE ${INDEXABLE} AND title_length BETWEEN 1 AND 29`,
  )
  sql(
    'meta-description.missing',
    `SELECT id FROM urls WHERE ${INDEXABLE} AND (meta_description IS NULL OR meta_description = '')`,
  )
  sql(
    'meta-description.too-long',
    `SELECT id, meta_description_length || ' characters' AS detail FROM urls
     WHERE ${INDEXABLE} AND meta_description_length > 160`,
  )
  sql(
    'h1.missing',
    `SELECT id FROM urls WHERE ${INDEXABLE} AND (h1_count = 0 OR h1 IS NULL)`,
  )
  sql(
    'h1.multiple',
    `SELECT id, h1_count || ' H1 headings' AS detail FROM urls WHERE ${INDEXABLE} AND h1_count > 1`,
  )

  // Duplicates (grouped in JS for Unicode-aware case folding)
  const pages = db
    .prepare(
      `SELECT id, url, title, meta_description, content_hash, simhash, word_count
       FROM urls WHERE ${INDEXABLE} ORDER BY url`,
    )
    .all() as Array<{
    id: number
    url: string
    title: string | null
    meta_description: string | null
    content_hash: string | null
    simhash: string | null
    word_count: number | null
  }>

  const duplicates = (
    issueId: string,
    key: (page: (typeof pages)[number]) => string | null,
  ) => {
    const groups = new Map<string, typeof pages>()
    for (const page of pages) {
      const value = key(page)
      if (!value) continue
      const group = groups.get(value) ?? []
      group.push(page)
      groups.set(value, group)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const page of group) {
        const others = group.filter((other) => other.id !== page.id)
        add(
          issueId,
          page.id,
          `Same as ${shortList(
            others.map((o) => o.url),
            2,
          )}`,
        )
      }
    }
    return groups
  }
  duplicates('title.duplicate', (p) => p.title?.toLowerCase() || null)
  duplicates(
    'meta-description.duplicate',
    (p) => p.meta_description?.toLowerCase() || null,
  )
  duplicates('content.exact-duplicate', (p) => p.content_hash || null)

  const candidates = pages
    .filter((p) => (p.word_count ?? 0) >= NEAR_DUPLICATE_MIN_WORDS)
    .map((p) => ({ ...p, hash: parseSimhash(p.simhash ?? '') }))
    .filter((p): p is typeof p & { hash: SimhashParts } => p.hash !== null)
  if (candidates.length <= NEAR_DUPLICATE_MAX_PAGES) {
    const best = new Map<number, { url: string; distance: number }>()
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i] as (typeof candidates)[number]
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j] as (typeof candidates)[number]
        if (a.content_hash && a.content_hash === b.content_hash) continue
        const distance = hammingDistance(a.hash, b.hash)
        if (distance > NEAR_DUPLICATE_MAX_DISTANCE) continue
        if ((best.get(a.id)?.distance ?? 99) > distance) {
          best.set(a.id, { url: b.url, distance })
        }
        if ((best.get(b.id)?.distance ?? 99) > distance) {
          best.set(b.id, { url: a.url, distance })
        }
      }
    }
    for (const [id, match] of best) {
      add(
        'content.near-duplicate',
        id,
        `Similar to ${match.url} (distance ${match.distance})`,
      )
    }
  }

  sql(
    'content.thin',
    `SELECT id, word_count || CASE WHEN word_count = 1 THEN ' word' ELSE ' words' END AS detail
     FROM urls WHERE ${INDEXABLE} AND word_count < 200`,
  )
  sql(
    'images.missing-alt',
    `SELECT id, images_missing_alt || ' of ' || images_total || CASE WHEN images_total = 1 THEN ' image' ELSE ' images' END AS detail FROM urls
     WHERE ${INDEXABLE} AND images_missing_alt > 0`,
  )

  // Security
  sql(
    'security.http-page',
    `SELECT id FROM urls WHERE ${PAGE} AND url LIKE 'http://%'`,
  )
  sql(
    'security.mixed-content',
    `SELECT id, insecure_resources || CASE WHEN insecure_resources = 1 THEN ' insecure resource' ELSE ' insecure resources' END AS detail FROM urls
     WHERE ${PAGE} AND insecure_resources > 0`,
  )
}
