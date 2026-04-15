# URL Tools - Architecture

## Overview

URL Tools is a collection of web scraping and analysis tools with a browser-based interface. Built with Nuxt 4 as a fullstack framework. Designed for local use — no multi-user, no auth.

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Nuxt 4](https://nuxt.com/) | Fullstack framework (Vue 3 + Nitro Server) |
| [Vue 3](https://vuejs.org/) | Frontend framework (Composition API) |
| [Cheerio](https://cheerio.js.org/) | HTML parsing (jQuery-like) |
| [Puppeteer](https://pptr.dev/) | Headless Chrome for screenshots/PDF |
| [PapaParse](https://www.papaparse.com/) | CSV generation and parsing |
| [Lucide](https://lucide.dev/) | Icon library |
| [Vitest](https://vitest.dev/) | Test framework |
| [Biome](https://biomejs.dev/) | Linter and formatter |
| [Docker](https://docker.com/) | Container deployment |
| [GitHub Actions](https://github.com/features/actions) | CI/CD pipeline |

## Project Structure

```
url-tools/
├── app/                          # Frontend (Vue 3)
│   ├── pages/
│   │   └── index.vue             # Main page with tab navigation
│   ├── components/               # Vue components
│   │   ├── BrokenLinkChecker.vue # Broken link checking
│   │   ├── GraphView.vue         # d3-force graph for Silo (path hierarchy + <a> edges)
│   │   ├── HelpTooltip.vue       # Teleport-based tooltip (no clipping)
│   │   ├── ImageScraper.vue      # Image extraction and download
│   │   ├── InboundGroupedView.vue# Silo: grouped-per-target stats view
│   │   ├── InboundLinkAnalyzer.vue# Silo: root tab component (flat/grouped/graph)
│   │   ├── LogDrawer.vue         # Global right-side log panel (resizable, persisted)
│   │   ├── RecentJobsMenu.vue    # Recent jobs / history
│   │   ├── RequestSettings.vue   # HTTP request settings
│   │   ├── ResultsTable.vue      # Results table (HTML/links)
│   │   ├── Screenshots.vue       # Screenshot/PDF creation
│   │   ├── SeoAudit.vue          # SEO analysis
│   │   ├── SettingsPanel.vue     # Mode-specific settings
│   │   ├── SitemapParser.vue     # Sitemap URL extraction
│   │   └── UrlInput.vue          # URL input with import/filter
│   └── composables/              # Reusable logic
│       ├── useFormatters.ts      # File size formatting
│       ├── useInboundAggregation.ts # Silo: aggregate raw InboundLinks into groups
│       ├── useLogStore.ts        # Module-level store for per-tab logs/progress/currentUrl
│       ├── useTableSort.ts       # Sortable table columns (asc/desc/none)
│       ├── useTheme.ts           # Dark/light mode
│       └── useUrlParser.ts       # URL parsing and validation
├── server/                       # Backend (Nitro)
│   ├── api/                      # REST/SSE endpoints
│   │   ├── analyze-inbound-links-stream.post.ts # Silo analysis (SSE)
│   │   ├── check-links.post.ts   # Link checking (SSE)
│   │   ├── clear-output.post.ts  # Clear output folder
│   │   ├── get-output-dir.get.ts # List output directory
│   │   ├── open-folder.get.ts    # Open folder in Finder
│   │   ├── open-output.post.ts   # Open output folder
│   │   ├── parse-sitemap.post.ts # Parse XML sitemap (wraps server/utils/sitemap.ts)
│   │   ├── read-file.get.ts      # Read file (with path guard)
│   │   ├── save-results.post.ts  # Save results (CSV/JSON/TXT) — html / links / inbound-links modes
│   │   ├── scrape-html.post.ts   # HTML scraping with CSS selectors
│   │   ├── scrape-images.post.ts # Image scraping and download
│   │   ├── scrape-json.post.ts   # JSON-LD/OpenGraph extraction
│   │   ├── scrape-links-stream.post.ts # Link analysis (SSE stream)
│   │   ├── screenshot.post.ts    # Screenshots/PDF (Puppeteer)
│   │   └── seo-audit.post.ts     # SEO audit with scoring
│   └── utils/                    # Server utilities
│       ├── domain-checker.ts     # DNS resolution for Link Checker domain badges
│       ├── fetch-with-retry.ts   # Fetch with linear backoff retry
│       ├── inbound-matcher.ts    # Silo: target matching + group aggregation
│       ├── link-analyzer.ts      # URL normalization, link extraction
│       ├── path-guard.ts         # Path traversal protection
│       ├── sanitize-headers.ts   # Header sanitization
│       ├── sitemap.ts            # Shared sitemap fetch/parse (used by parse-sitemap + silo)
│       └── url-validator.ts      # SSRF protection
├── public/
│   └── demo/dead-links.html      # Link Checker domain-badge test fixture
├── output/                       # Generated results (gitignored)
│   ├── scraper/                  # html + links
│   ├── silo/                     # inbound-links
│   ├── seo-audit/
│   ├── screenshots/
│   └── images/
├── .github/workflows/ci.yml     # CI/CD pipeline
├── Dockerfile                    # Multi-stage Docker build
├── docker-compose.yml            # Docker Compose configuration
└── nuxt.config.ts                # Nuxt configuration
```

## Auth Concept

**None.** Deliberate decision — URL Tools is designed for local use. No login, no sessions, no multi-user. See [ADR-005](adr/005-localhost-only.md).

## Security Model

Although there is no auth, there are multiple layers of security:

| Protection | Implementation | File |
|------------|---------------|------|
| SSRF protection | Blocks localhost, private IPs, file:// | `server/utils/url-validator.ts` |
| Path traversal | File access restricted to output directory | `server/utils/path-guard.ts` |
| Header injection | Blocks Host, Authorization, Cookie, etc. | `server/utils/sanitize-headers.ts` |
| ReDoS protection | URL filter regex max. 200 characters | `server/api/scrape-links-stream.post.ts` |
| Response limit | Max. 10 MB per fetch response | Individual API endpoints |
| Header limit | Max. 20 custom headers | `server/utils/sanitize-headers.ts` |

## Data Flow

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser     │────>│  Nitro Server    │────>│  External URLs   │
│   (Vue 3)     │<────│  (API Endpoints) │<────│  (Websites)      │
└──────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              v
                     ┌──────────────────┐
                     │  Filesystem      │
                     │  output/         │
                     │  ├── scraper/    │
                     │  ├── seo-audit/  │
                     │  ├── screenshots/│
                     │  └── images/     │
                     └──────────────────┘
```

1. **User** enters URLs and selects mode/settings
2. **Frontend** sends request to Nitro API (REST or SSE stream)
3. **Server** fetches external URLs with retry logic and timeout
4. **Results** are streamed to the frontend or returned as a batch
5. **Auto-save** stores results as JSON/CSV/HTML in the output folder (default: `~/Documents/url-tools`, configurable via `OUTPUT_DIR`)

## Shared Services

### Frontend Composables

| Composable | Purpose |
|------------|---------|
| `useUrlParser` | Parses URLs from textarea (newline/comma-separated), validates with `new URL()` |
| `useLogStore` / `useTabLogger` | Global log/progress/current-URL store keyed by tab; feeds the `LogDrawer`. Module-level reactive state. See [ADR-010](adr/010-global-log-drawer.md) |
| `useInboundAggregation` | Silo: aggregate flat `InboundLink[]` into per-target groups with anchor-text distribution |
| `useTheme` | Dark/light mode toggle, localStorage persistence, system preference detection |
| `useFormatters` | File size formatting (B, KB, MB) |
| `useTableSort` | Generic table column sorting (asc → desc → unsorted cycle), handles numbers/strings/booleans |

### Server Utilities

| Utility | Purpose |
|---------|---------|
| `fetchWithRetry` | HTTP fetch with configurable timeout and linear backoff (1s → 2s → 3s) |
| `link-analyzer` | URL normalization, link extraction (HTML + sitemap), redirect chain analysis |
| `sitemap` | Shared sitemap fetch loop used by both `parse-sitemap` endpoint and Silo sitemap-scope mode |
| `inbound-matcher` | Silo: normalize targets, match discovered links, aggregate into groups |
| `domain-checker` | DNS lookup for Link Checker domain badges (Available / Subdomain missing / timeout / error) |
| `url-validator` | SSRF protection: blocks localhost, private IPs (10.x, 192.168.x, 172.16-31.x). Localhost can be opted back in via `URL_TOOLS_ALLOW_LOCALHOST=1` for crawling bundled `/demo/` fixtures |
| `path-guard` | Ensures file paths stay within the output directory, exports `OUTPUT_ROOT` |
| `sanitize-headers` | Removes dangerous HTTP headers (Host, Authorization, Cookie, X-Forwarded-*, Proxy-Authorization) |

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OUTPUT_DIR` | `~/Documents/url-tools` | Where results are written |
| `URL_TOOLS_ALLOW_LOCALHOST` | `0` | When `1`, disables the SSRF guard's localhost block. Needed to crawl the bundled `public/demo/` fixtures (e.g. the Link Checker domain-badge demo). Dev only — never set in production. |

## Further Documentation

- [Data Model & API Reference](data-model.md)
- [Architecture Decision Records](adr/README.md)
- [Modules](modules/README.md)
- [Runbooks](runbooks/)
