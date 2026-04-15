# URL Tools - Data Model & API Reference

> No traditional database schema — URL Tools uses the filesystem as its persistence layer. This document describes the output structure and all API endpoints.

**Output directory:** Configurable via `OUTPUT_DIR` environment variable. Default: `~/Documents/url-tools`. In Docker: `/app/output`.

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
event: result   → { sourceUrl, targetUrl, status, statusText, isBroken, isInternal, anchorText, error? }
event: progress → { done, total, currentUrl }
event: log      → { message, type }
event: done     → { totalLinks, brokenCount, okCount, visited }
```

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
  mode: 'html' | 'links'
  baseOutputDir?: string            // Reuse existing output directory
}
```

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

Open the output folder in the system file manager.

**Response:** `{ ok: boolean }`

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
