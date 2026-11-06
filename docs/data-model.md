# URL Tools - Data Model & API Reference

> No traditional database schema — URL Tools uses the filesystem as its persistence layer. This document describes the output structure and all API endpoints.

**Output directory:** Configurable via `OUTPUT_DIR` environment variable. Default: `output/` in the working directory (the project folder with `npm run dev`). In Docker Compose: `/app/output`.

## Output Directory Structure

```
output/
├── scraper/
│   ├── {timestamp}_html_files/          # HTML scraping results
│   │   ├── 001_example_com.html         # Individual HTML files
│   │   ├── 002_other_site_de.html
│   │   └── ...
│   ├── {timestamp}_html_meta.json       # Metadata (URL, status, size)
│   ├── {timestamp}_html_meta.csv
│   ├── {timestamp}_links.json           # Link analysis results
│   ├── {timestamp}_links.csv
│   └── {timestamp}_links.txt            # URL list (one per line)
├── seo-audit/
│   ├── {timestamp}_seo-audit.json       # SEO audit results
│   └── {timestamp}_seo-audit.csv
├── crawls/
│   └── {crawl-id}.sqlite                # Site Audit: one SQLite file per crawl
├── screenshots/
│   └── {timestamp}/                     # Screenshot folder
│       ├── 001_example_com.png
│       ├── 002_other_site_de.pdf
│       └── ...
└── images/
    └── {timestamp}/                     # Image download folder
        ├── example_com/                 # Optional: subfolder per URL
        │   └── image_001.jpg
        └── other_site_de/
            └── image_001.png
```

**Timestamp format:** `YYYY-MM-DD_HH-MM-SS`

---

## API Endpoints

### POST /api/scrape-html

HTML scraping with optional CSS selector and retry logic.

**Request:**
```typescript
{
  urls: string[]                    // Required, at least 1 URL
  cssSelector?: string              // Optional: CSS selector for filtering
  settings?: {
    timeout: number                 // Seconds (default: 30)
    retries: number                 // 0-3 (default: 1)
    proxy?: string                  // HTTP proxy (http://host:port)
    headers?: Record<string, string> // Custom HTTP headers
  }
}
```

**Response:**
```typescript
{
  results: [{
    url: string
    status: number
    contentType: string
    size: number                    // Bytes
    html: string
    error?: string
    retryCount?: number
  }]
}
```

**Behavior:** Batch processing with 5 parallel requests. Max. 10 MB per response.

---

### POST /api/scrape-links-stream (SSE)

Link analysis with live streaming via Server-Sent Events.

**Request:**
```typescript
{
  urls: string[]                    // Required
  recursive: boolean                // Recursive crawling
  maxUrls: number                   // 1-10,000 (default: 100)
  maxDepth: number                  // Crawling depth
  rateLimit: number                 // Requests/second (default: 2)
  sameDomainOnly: boolean           // Only crawl same domain
  urlFilter?: string                // Regex filter (max. 200 characters)
  pathInclude?: string              // Comma-separated paths (e.g. "/en/,/blog/")
  pathExclude?: string              // Paths to exclude
  settings?: RequestSettings
}
```

**SSE Events:**
```typescript
event: result     → LinkResult     // Individual link result
event: progress   → { done, total, currentUrl }
event: log        → { message, type }
event: done       → { totalLinks, visited }
event: error      → { message }
```

**LinkResult:**
```typescript
{
  sourceUrl: string
  targetUrl: string
  status: number
  redirectChain: string             // e.g. "200 → 301 → 200"
  type: 'internal' | 'external'
  anchorText: string
  rel: string
  depth: number
  error?: string
}
```

---

### POST /api/analyze-inbound-links-stream (SSE)

Inbound ("silo") analysis — crawl a site and find which pages link TO one or more target URLs.

**Request:**
```typescript
{
  startUrls: string[]                    // Seed URLs (or sitemap URLs)
  crawlScope: 'recursive' | 'sitemap'
  targetMode: 'single' | 'multi' | 'matrix'
  targets?: string[]                     // Required for single/multi, max 500
  maxUrls?: number                       // Default 200, cap 10,000
  maxDepth?: number                      // Default 3, cap 10
  rateLimit?: number                     // Default 2 req/s
  pathInclude?: string
  pathExclude?: string
  settings?: RequestSettings
}
```

**SSE Events:**
```typescript
event: result    → InboundLink
event: progress  → { done, total, currentUrl }
event: log       → { message, type }
event: done      → { pagesProcessed, inboundFound, visited }
event: error     → { message }
```

**InboundLink:**
```typescript
{
  sourceUrl: string
  targetUrl: string
  anchorText: string
  rel: string
  sourceStatus: number
  depth: number
}
```

**InboundGroup** (client-side aggregation):
```typescript
{
  targetUrl: string
  inboundCount: number
  uniqueSources: number
  sources: { sourceUrl: string; anchorTexts: string[]; rels: string[] }[]
  anchorDistribution: Record<string, number>
}
```

Output saved to `OUTPUT_DIR/silo/`:
- `<timestamp>_inbound-links.json` — full results
- `<timestamp>_inbound-links.csv` — flat CSV
- `<timestamp>_inbound-links.txt` — unique source URLs

---

### POST /api/scrape-images

Extract images from web pages and optionally download them.

**Request:**
```typescript
{
  urls: string[]                    // Required
  download: boolean                 // Download images?
  minWidth?: number                 // Min. width in pixels (default: 0)
  minHeight?: number                // Min. height in pixels (default: 0)
  formats?: string[]                // e.g. ['jpg', 'png', 'webp']
  subfolderPerUrl?: boolean         // Subfolder per URL (default: false)
  outputDir?: string                // Reuse existing output directory
}
```

**Response:**
```typescript
{
  results: [{
    sourceUrl: string
    images: [{
      src: string
      alt: string
      width?: number
      height?: number
      size?: number                 // Bytes (only when downloaded)
      filename?: string
      localPath?: string            // Local file path (only when downloaded)
      error?: string
    }]
    total: number
    downloaded: number
    error?: string
  }]
  outputDir: string | null
  stats: { pages, totalImages, downloaded }
}
```

**Sources:** `<img>` tags (src, data-src, data-lazy-src), background images, srcset.

---

### POST /api/scrape-json

Extract structured data (JSON-LD, Open Graph, Twitter Cards).

**Request:**
```typescript
{
  urls: string[]
  settings?: RequestSettings
}
```

**Response:**
```typescript
{
  results: [{
    url: string
    status: number
    jsonLd: object[]                // JSON-LD schema data
    openGraph: {                    // Open Graph tags
      title?, description?, image?, url?, type?, siteName?
    }
    twitterCard: {                  // Twitter Card tags
      card?, title?, description?, image?, site?
    }
    meta: {                         // Standard meta tags
      title?, description?, canonical?, robots?
    }
    error?: string
  }]
}
```

---

### POST /api/seo-audit

SEO analysis with score calculation (0-100).

**Request:**
```typescript
{
  urls: string[]                    // Bulk mode
  url?: string                      // Legacy: single URL
  checkLinks?: boolean              // 404 check (default: false)
  saveResults?: boolean             // Save to output/
  settings?: RequestSettings
}
```

**Response:**
```typescript
{
  results: [{
    url: string
    status: number
    loadTime: number                // Milliseconds
    size: number                    // Bytes
    contentHash: number             // Simhash for Duplicate Detection
    isDuplicate?: boolean
    duplicateOf?: string
    title: { text, length, isGood } // Good: 30-60 characters
    description: { text, length, isGood } // Good: 120-160 characters
    canonical: string | null
    robots: string | null
    headings: [{ tag, text, count }]
    h1Count: number
    hasMultipleH1: boolean
    imagesWithoutAlt: number
    totalImages: number
    internalLinks: number
    externalLinks: number
    brokenLinks: [{ href, text, status, isInternal, isBroken }]
    hasViewport, hasCharset, hasFavicon: boolean
    hasJsonLd, hasOpenGraph, hasTwitterCard: boolean
    score: number                   // 0-100
    issues: string[]
    error?: string
  }]
  savedFiles: string[]              // JSON and CSV file paths
  stats: { total, success, failed, avgScore }
}
```

**Score deductions:**

| Issue | Deduction |
|-------|-----------|
| No title | -15 |
| Title too short/long | -5 |
| No meta description | -10 |
| Description too short/long | -3 |
| No canonical | -5 |
| No H1 | -10 |
| Multiple H1 | -5 |
| Images without alt (per image, max. -10) | -2 |
| No viewport | -5 |
| No JSON-LD | -3 |
| No Open Graph | -3 |
| Broken links (per link, max. -15) | -3 |

---

### POST /api/screenshot

Screenshots and PDFs via Puppeteer (Headless Chrome).

**Request:**
```typescript
{
  urls: string[]                    // Required
  format: 'png' | 'jpg' | 'pdf'
  viewport: {
    width: number                   // 100-3840 (default: 1280)
    height: number                  // 100-4096 (default: 800)
  }
  fullPage: boolean                 // Full scroll height
  quality?: number                  // 0-100 (JPG only)
  timeout?: number                  // Seconds (default: 30)
  outputDir?: string                // Reuse existing output directory
  startIndex?: number               // Starting index for filename numbering
}
```

**Response:**
```typescript
{
  results: [{
    url: string
    success: boolean
    filename?: string               // e.g. "001_example_com.png"
    size?: number
    error?: string
  }]
  outputDir: string
  stats: { total, success, failed }
}
```

**Viewport presets:** Desktop (1920x1080), 4K (3840x2160), Laptop (1366x768), Tablet (768x1024), Mobile (375x812)

---

### POST /api/check-links (SSE)

Broken link checking with Server-Sent Events.

**Request:**
```typescript
{
  urls: string[]
  recursive?: boolean               // default: false
  maxDepth?: number                 // 1-5 (default: 1)
  maxUrls?: number                  // min 1 (default: 500)
  sameDomainOnly?: boolean
  externalOnly?: boolean
  excludeDomains?: string[]         // e.g. ["*.wikipedia.org", "facebook.com"]
  settings?: RequestSettings        // includes parallelRequests (1-20, default: 5)
}
```

**SSE Events:**
```typescript
event: result   → BrokenLinkResult
event: progress → { done, total, currentUrl }
event: log      → { message, type }
event: done     → { totalLinks, brokenCount, okCount, visited }
```

**BrokenLinkResult:**
```typescript
{
  sourceUrl: string
  targetUrl: string
  status: number
  statusText: string
  isBroken: boolean
  isInternal: boolean
  anchorText: string
  error?: string
  domainStatus?: 'resolved' | 'available' | 'subdomain-gone' | 'timeout' | 'error' | 'skipped'
    // DNS-level check: does the target domain resolve?
    // - resolved: domain has DNS records
    // - available: NXDOMAIN (domain is likely unregistered/free)
    // - subdomain-gone: subdomain NXDOMAIN but parent domain resolves
    // - timeout/error: DNS lookup failed for other reasons
    // - skipped: IP address or internal link (not checked)
  domainError?: string // DNS error code or message (e.g. 'NXDOMAIN', 'ECONNREFUSED', 'DNS timeout')
}
```

See [ADR-009](adr/009-dns-domain-availability.md) for the rationale behind DNS-based availability detection.

---

### POST /api/parse-sitemap

Parse XML sitemap and extract URLs.

**Request:**
```typescript
{
  url: string                       // Sitemap URL
  recursive?: boolean               // Follow sitemap index
}
```

**Response:**
```typescript
{
  urls: [{
    loc: string
    lastmod?: string
    changefreq?: string
    priority?: string
    source: string                  // Source sitemap
  }]
  stats: { total, sitemaps }
}
```

**Limits:** Max. 50 sitemaps, max. 50,000 URLs, max. 10 MB per sitemap.

---

### POST /api/save-results

Save results as files.

**Request:**
```typescript
{
  results: Record<string, unknown>[]
  format: 'csv' | 'json' | 'both'
  mode: 'html' | 'links' | 'inbound-links' | 'seo'
  baseOutputDir?: string            // Reuse existing output directory
  sourceUrls?: string[]             // The URL(s) that were checked
}
```

**Filename:** `<timestamp>_<mode>.<ext>`. When `sourceUrls` contains exactly one
distinct URL, it is folded in as `<timestamp>_<url>_<mode>.<ext>` (a bare domain
yields the host without `www.`, a deeper URL yields host + path). The timestamp
stays first so files sort chronologically.

**Response:**
```typescript
{
  success: boolean
  files: string[]                   // Saved file paths
  message: string
}
```

---

### POST /api/clear-output

Clear the entire output folder.

**Response:** `{ success: boolean, message: string }`

### POST /api/open-output

Open the output folder in the system file manager. Creates the folder first if
it does not exist yet.

**Response:** `{ success: boolean }` (throws 500 if the OS open command fails,
e.g. on a headless server)

### GET /api/get-output-dir

List the output directory.

**Response:**
```typescript
{
  outputDir: string
  files: [{
    name: string
    path: string
    size: number
    modified: string                // ISO 8601
    type: 'json' | 'csv' | 'html' | 'folder' | 'other'
  }]
}
```

### GET /api/read-file

Read a file (with path guard).

**Query:** `?path=/absolute/path&base64=true|false`

**Response:** `{ content: string }`

**Errors:** 403 for paths outside `output/`, 404 for missing files.

### GET /api/open-folder

Open a folder in Finder/Explorer.

**Query:** `?path=/absolute/path`

**Response:** `{ success: boolean }`

---

## Site Audit API

All endpoints live under `/api/site-audit`. Crawl ids look like `2026-11-05_14-03-43_example.com` (timestamp + host, optional `_2` suffix). Types: `server/crawler/queries.ts` and `server/crawler/engine.ts`. Module docs: [site-audit.md](modules/site-audit.md).

### GET /api/site-audit/crawls

```typescript
{ crawls: CrawlSummary[] }          // newest first

interface CrawlSummary {
  crawlId: string
  startUrl: string
  status: 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted'
  source: 'ui' | 'mcp' | 'api'
  startedAt: string | null          // ISO
  finishedAt: string | null
  urlsFetched: number
  issues: { error: number; warning: number; notice: number }  // affected URLs per severity
  sizeBytes: number
  progress?: CrawlProgress          // only while running
}
```

`interrupted` = the file says `running`, but no crawl job exists (server restarted during the crawl).

### POST /api/site-audit/crawls

Starts a crawl in the background.

**Request:**
```typescript
{
  startUrl: string                  // Required, http(s)
  maxUrls?: number                  // 1-10,000 (default: 500)
  maxDepth?: number                 // 0-50 (default: 10)
  concurrency?: number              // 1-10 (default: 4)
  requestsPerSecond?: number        // 0.2-20 (default: 5)
  respectRobots?: boolean           // default: true
  checkExternal?: boolean           // default: true
  useSitemaps?: boolean             // default: true
  includeSubdomains?: boolean       // default: false
  includePaths?: string | string[]  // path prefixes, comma-separated or array
  excludePaths?: string | string[]
  userAgent?: string
  headers?: Record<string, string>  // sanitized like RequestSettings.headers
}
```

**Response:** `{ crawlId: string, progress: CrawlProgress }`. **Errors:** 400 (invalid or blocked URL), 429 (3 crawls already running).

### GET /api/site-audit/crawls/:id/events (SSE)

| Event | Data |
|-------|------|
| `progress` | `CrawlProgress` (throttled to 4/s) |
| `log` | `{ time, message, type: 'info' \| 'success' \| 'warning' \| 'error' \| 'progress' }` |
| `done` | final `CrawlProgress` (or `CrawlSummary` for crawls finished earlier) |

```typescript
interface CrawlProgress {
  crawlId: string
  status: CrawlSummary['status']
  startUrl: string
  fetched: number; queued: number; discovered: number
  failed: number; blocked: number
  externalChecked: number; externalQueued: number
  currentUrl: string | null
  phase: 'starting' | 'crawling' | 'sitemaps' | 'externals' | 'analyzing' | 'done'
  elapsedMs: number
  issueCount?: number
  error?: string
}
```

### POST /api/site-audit/crawls/:id/stop

Stops a running crawl; the data collected so far is analysed (status `stopped`). 409 if the crawl is not running.

### GET /api/site-audit/crawls/:id/overview

Totals (`urls`, `internal`, `external`, `fetched`, `htmlPages`, `indexable`, `nonIndexable`, `blockedByRobots`, `failed`, `notCrawled`), `statusCodes` (internal URLs per `2xx`/`3xx`/`4xx`/`5xx`/`failed`/`blocked`/`not crawled`), `indexability` (count per reason), `depth` (HTML pages per click depth), `responseTimeMs` (`average`, `max`), `topIssues` (top 10 with 3 examples each), `config` (resolved crawl options).

### GET /api/site-audit/crawls/:id/issues

Query: `severity` (`error` / `warning` / `notice`), `category`. Returns `{ issues: IssueSummary[] }`: catalog entry (`id`, `category`, `severity`, `title`, `description`, `why`, `fix`) plus `count` and up to 5 `examples` (`url`, `detail`). Only issues with at least one URL, sorted by severity, then count.

### GET /api/site-audit/crawls/:id/urls

Query: `filter` (`all`, `internal`, `external`, `html`, `indexable`, `non-indexable`, `2xx`, `3xx`, `4xx`, `5xx`, `failed`, `blocked`, `not-crawled`), `issue` (issue id; adds `issue_detail`), `search` (substring of URL or title), `columns` (comma-separated, whitelist `URL_COLUMNS`), `sort`, `dir` (`asc`/`desc`), `limit` (1-500, default 50), `offset`.

**Response:** `{ total, offset, limit, columns, rows }`.

### GET /api/site-audit/crawls/:id/url?url=

Details of one URL: `url` (all columns of the `urls` row), `issues`, `inlinks` (`total`, `items`), `outlinks` (`total`, `items` with target status), `hreflang`, `redirectChain` (`[{ url, status }]`), `sitemaps`. 404 with a hint if the URL is not in the crawl.

### GET /api/site-audit/crawls/:id/export?kind=

CSV download (UTF-8 with BOM): `issues` (severity, issue id, title, URL, detail), `urls` (all URL columns), `links` (source, target, anchor, nofollow, target status).

### GET /api/site-audit/catalog

`{ issues: IssueDefinition[] }` — all 45 checks with explanations.

### POST /mcp

MCP endpoint for AI agents (JSON-RPC 2.0, stateless Streamable HTTP). See [agent-interface.md](modules/agent-interface.md).

---

## Crawl File (SQLite)

`<OUTPUT_DIR>/crawls/<crawl-id>.sqlite`, `PRAGMA user_version = 1`, `PRAGMA application_id = 0x55544C53`. Open it read-only with any SQLite client:

```bash
sqlite3 -readonly crawls/2026-11-05_14-03-43_example.com.sqlite \
  "SELECT severity, issue_id, COUNT(*) FROM v_issues GROUP BY 1, 2 ORDER BY 1, 3 DESC"
```

| Table / View | Content |
|--------------|---------|
| `meta` | `key`/`value`: `tool`, `tool_version`, `crawl_id`, `start_url`, `started_at`, `finished_at`, `status`, `source`, `config` (JSON), `stats` (JSON), `issue_counts` (JSON), `error` |
| `urls` | One row per discovered URL (see below) |
| `links` | `source_id`, `target_id`, `anchor`, `rel`, `nofollow` (unique per source/target pair) |
| `hreflang` | `source_id`, `lang`, `target_id` |
| `sitemap_urls` | `url_id`, `sitemap` (sitemap file that lists the URL) |
| `issue_catalog` | `issue_id`, `category`, `severity`, `title`, `description`, `why`, `fix` |
| `issues` | `issue_id`, `url_id`, `detail` (evidence, e.g. the redirect chain) |
| `v_issues` | Issues joined with catalog and URL: `issue_id`, `severity`, `category`, `title`, `url`, `detail` |
| `v_links` | Links with URLs: `source`, `target`, `anchor`, `rel`, `nofollow`, `target_is_internal`, `target_status` |

**`urls` columns:**

| Column | Meaning |
|--------|---------|
| `url`, `is_internal` | Absolute URL (fragment removed, trailing slash kept); internal = start host and its www/non-www twin (plus subdomains if enabled) |
| `found_via`, `depth` | `seed` / `link` / `redirect` / `canonical` / `hreflang` / `sitemap`; click depth from the start URL (`NULL` = not reachable via links) |
| `crawl_state` | `fetched`, `failed`, `blocked_robots`, `blocked_target` (SSRF guard), `excluded` (path filter), `skipped_limit`, `not_checked` (external, check disabled), `pending` |
| `status_code`, `error`, `content_type`, `is_html`, `response_ms`, `size_bytes` | Response of this URL (no automatic redirect following) |
| `redirect_url`, `final_url`, `final_status`, `redirect_hops` | Location of a 3xx and the resolved end of the chain |
| `title`, `title_length`, `title_count`, `meta_description`, `meta_description_length`, `meta_description_count`, `h1`, `h1_count`, `h2_count` | On-page signals |
| `meta_robots`, `x_robots_tag`, `noindex`, `nofollow` | Robots directives (all bots or Googlebot) |
| `canonical_url`, `canonical_count`, `canonical_relative` | First canonical (HTML or `Link` header), number of different canonicals, relative href used |
| `lang`, `meta_refresh_url` | `<html lang>`, meta refresh target |
| `word_count`, `content_hash`, `simhash` | Main text without navigation/header/footer/forms; SHA-1 of the word sequence; 64-bit SimHash (hex) |
| `images_total`, `images_missing_alt`, `insecure_resources` | Images, images without `alt` attribute, `http:` subresources on HTTPS pages |
| `in_sitemap`, `inlinks`, `outlinks`, `external_outlinks` | Derived after the crawl |
| `indexable`, `indexability_reason` | `1`/`0` for internal URLs (NULL for non-HTML); reason: `noindex`, `canonicalised`, `redirect`, `client_error`, `server_error`, `blocked_robots`, `fetch_failed`, `other_status` |

---

## Shared Types

### RequestSettings

```typescript
interface RequestSettings {
  timeout: number                   // Seconds (1-120, default: 30)
  retries: number                   // 0-5 (default: 1)
  proxy?: string                    // HTTP proxy
  headers?: Record<string, string>  // Custom headers (max. 20)
}
```

### Retry Behavior

| Error Type | Action |
|------------|--------|
| Timeout | Retry with backoff |
| 5xx server error | Retry with backoff |
| 4xx client error | No retry |
| Network error | Retry with backoff |

**Backoff:** 1s → 2s → 3s (linear)
