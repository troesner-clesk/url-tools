# URL Tools - Architecture

## Overview

URL Tools is a collection of web scraping and analysis tools with a browser-based interface. Built with Nuxt 4 as a fullstack framework. Designed for local use — no multi-user, no auth.

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Nuxt 4](https://nuxt.com/) | Fullstack framework (Vue 3 + Nitro Server) |
| [Vue 3](https://vuejs.org/) | Frontend framework (Composition API) |
| [Cheerio](https://cheerio.js.org/) | HTML parsing (jQuery-like) |
| [node:sqlite](https://nodejs.org/api/sqlite.html) | Site Audit crawl files, one SQLite file per crawl (built into Node, see [ADR-011](adr/011-sqlite-crawl-file.md)) |
| [MCP](https://modelcontextprotocol.io/) | Agent interface at `/mcp`, own minimal implementation (see [ADR-012](adr/012-mcp-agent-interface.md)) |
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
│   │   ├── SiteAudit.vue         # Site Audit: start/follow crawls, crawl list, results header
│   │   ├── SiteAuditOverview.vue # Site Audit: key figures, distributions, top issues
│   │   ├── SiteAuditIssues.vue   # Site Audit: issues by severity with explanations
│   │   ├── SiteAuditUrlTable.vue # Site Audit: server-side paged URL table
│   │   ├── SiteAuditUrlDetail.vue# Site Audit: URL detail dialog (links, hreflang, chain)
│   │   ├── SitemapParser.vue     # Sitemap URL extraction
│   │   └── UrlInput.vue          # URL input with import/filter
│   ├── utils/site-audit.ts       # Client types, filters and formatters for the Site Audit
│   └── composables/              # Reusable logic
│       ├── useFormatters.ts      # File size formatting
│       ├── useInboundAggregation.ts # Silo: aggregate raw InboundLinks into groups
│       ├── useLogStore.ts        # Module-level store for per-tab logs/progress/currentUrl
│       ├── useTableSort.ts       # Sortable table columns (asc/desc/none)
│       ├── useTheme.ts           # Dark/light mode
│       └── useUrlParser.ts       # URL parsing and validation
├── server/                       # Backend (Nitro)
│   ├── crawler/                  # Site Audit core (ADR-011/013)
│   │   ├── engine.ts             # Breadth-first crawler, job registry, live progress
│   │   ├── http-client.ts        # node:http(s) client, no auto-redirects, size/time limits
│   │   ├── net-guard.ts          # SSRF guard on resolved IPs (every connection)
│   │   ├── robots.ts             # robots.txt (RFC 9309)
│   │   ├── parse-page.ts         # On-page signals, links, canonicals, hreflang, main text
│   │   ├── content.ts            # Word count, content hash, 64-bit SimHash
│   │   ├── store.ts              # SQLite crawl file (schema, writer)
│   │   ├── analyze.ts            # Site-wide checks → issues table
│   │   ├── catalog.ts            # Issue catalog (stable ids, severity, explanations)
│   │   ├── queries.ts            # Read layer shared by UI API and MCP
│   │   └── sql-sandbox.ts        # Read-only SQL in a child process (MCP run_sql)
│   ├── mcp/                      # MCP protocol + tools (ADR-012)
│   ├── middleware/
│   │   └── local-guard.ts        # Host/Origin guard for /api and /mcp (ADR-013)
│   ├── routes/
│   │   └── mcp.ts                # POST /mcp (Streamable HTTP, stateless)
│   ├── api/                      # REST/SSE endpoints
│   │   ├── site-audit/           # Site Audit: crawls, events (SSE), overview, issues, urls, export
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
│       ├── request-guard.ts      # Host/Origin checks used by the local-guard middleware
│       ├── sanitize-headers.ts   # Header sanitization
│       ├── sitemap.ts            # Shared sitemap fetch/parse (used by parse-sitemap + silo)
│       └── url-validator.ts      # SSRF protection
├── public/
│   └── demo/dead-links.html      # Link Checker domain-badge test fixture
├── output/                       # Generated results (gitignored)
│   ├── crawls/                   # Site Audit: <crawl-id>.sqlite
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
| SSRF protection | Blocks localhost, private IPs, file:// in the URL string | `server/utils/url-validator.ts` |
| SSRF protection (scraping tools) | Follows redirects itself and checks the resolved IP of every hop; screenshots abort blocked browser requests (request interception) | `server/utils/safe-fetch.ts`, `server/api/screenshot.post.ts` |
| SSRF protection (Site Audit) | Checks the resolved IP of every connection incl. redirect hops; blocks loopback, private, link-local, CGNAT, reserved, IPv6 equivalents | `server/crawler/net-guard.ts` |
| Cross-site / DNS rebinding | `/api/**` and `/mcp` only accept local `Host` headers (or `URL_TOOLS_ALLOWED_HOSTS`) and browser requests from the url-tools page itself (`Origin` = own origin, `Sec-Fetch-Site` = `same-origin`/`none`); other websites and other local web apps are rejected | `server/middleware/local-guard.ts` |
| Agent safety | MCP read-only by default, crawl tools only with `URL_TOOLS_MCP_ALLOW_CRAWL=1`, crawled content marked as untrusted, results paged and capped | `server/mcp/tools.ts` |
| SQL sandbox | `run_sql` in a child process: read-only connection, authorizer (reads only), heap limit, hard kill after timeout | `server/crawler/sql-sandbox.ts` |
| Polite crawling | robots.txt (RFC 9309), global rate limit, concurrency limit, max. 3 parallel crawls | `server/crawler/engine.ts` |
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
5. **Auto-save** stores results as JSON/CSV/HTML in the output folder (default: `output/` in the working directory, configurable via `OUTPUT_DIR`)

**Site Audit:** crawl once, analyse everywhere. `POST /api/site-audit/crawls` (UI) or `start_crawl` (MCP) starts a background job (`server/crawler/engine.ts`) that writes straight into `crawls/<crawl-id>.sqlite`; progress is streamed via `GET .../events` (SSE). After the crawl, `analyze.ts` derives redirect chains, link counts and indexability and fills the `issues` table. The UI endpoints, CSV exports and MCP tools all read through `server/crawler/queries.ts`, so they always show the same numbers. See [modules/site-audit.md](modules/site-audit.md).

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
| `fetchWithRetry` | HTTP fetch with configurable timeout and linear backoff (1s → 2s → 3s), uses `safeFetch` |
| `safe-fetch` | `safeFetch` (redirects followed manually, every hop checked incl. DNS), `blockedTargetReason`, cached check for Puppeteer requests (ADR-013) |
| `link-analyzer` | URL normalization, link extraction (HTML + sitemap), redirect chain analysis |
| `sitemap` | Shared sitemap fetch loop used by both `parse-sitemap` endpoint and Silo sitemap-scope mode |
| `inbound-matcher` | Silo: normalize targets, match discovered links, aggregate into groups |
| `domain-checker` | DNS lookup for Link Checker domain badges (Available / Subdomain missing / timeout / error) |
| `url-validator` | SSRF protection: blocks localhost, private IPs (10.x, 192.168.x, 172.16-31.x). Localhost can be opted back in via `URL_TOOLS_ALLOW_LOCALHOST=1` for crawling bundled `/demo/` fixtures |
| `path-guard` | Ensures file paths stay within the output directory, exports `OUTPUT_ROOT` |
| `request-guard` | Host/Origin/Sec-Fetch-Site checks for the local-guard middleware (ADR-013) |
| `sanitize-headers` | Removes dangerous HTTP headers (Host, Authorization, Cookie, X-Forwarded-*, Proxy-Authorization) |

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OUTPUT_DIR` | `output/` in the working directory | Where results are written (Docker Compose: `/app/output`) |
| `URL_TOOLS_ALLOW_LOCALHOST` | `0` | When `1`, disables the SSRF guard's localhost block (also loopback addresses in the Site Audit guard, never private networks). Needed to crawl the bundled `public/demo/` fixtures (e.g. the Link Checker domain-badge demo) and used by the crawler tests. Dev only — never set in production. |
| `URL_TOOLS_ALLOWED_HOSTS` | (empty) | Comma-separated extra host names/IPs under which the UI/API/MCP may be reached (LAN, reverse proxy). `*` disables the host check. |
| `URL_TOOLS_MCP_ALLOW_CRAWL` | `0` | When `1`, MCP clients may start and stop crawls (`start_crawl`, `stop_crawl`). Off: agents can only read crawls. |

## Further Documentation

- [Data Model & API Reference](data-model.md)
- [Architecture Decision Records](adr/README.md)
- [Modules](modules/README.md)
- [Runbooks](runbooks/)
