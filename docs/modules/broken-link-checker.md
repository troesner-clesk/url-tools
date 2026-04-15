# Module: Broken Link Checker

## Purpose

Check all links on a web page for broken URLs (4xx, 5xx, connection errors). Results are streamed in real-time via Server-Sent Events with color-coded status badges.

## Features

- **Live Streaming** — Results appear in real-time via SSE
- **Parallel Checking** — Configurable concurrent requests (default 5)
- **Recursive Crawling** — Follow internal links and check subpages
- **Domain Exclusion** — Skip specific domains (supports wildcards like `*.example.com`)
- **External Only Mode** — Only check outbound links
- **Type Filtering** — Filter results by All / Internal / External
- **Broken Only Filter** — Show only broken links
- **Domain Availability Detection** — Flag unregistered/free domains in outbound links
- **Sortable Columns** — Click column headers to sort results
- **TSV Export** — Copy results to clipboard

## Data Model

- **Endpoint:** `POST /api/check-links` (SSE)
- Details: see [data-model.md](../data-model.md)

## Data Flow

1. User enters URLs to check
2. User configures settings (max links, recursive, domain exclusions)
3. Frontend opens SSE connection to the server
4. Server fetches each page, extracts links, checks each link's HTTP status
5. Results stream to the frontend as events:
   - `result` — single link check result (status, broken, internal/external)
   - `progress` — progress (done/total, current URL)
   - `log` — status messages
   - `done` — summary (total, broken, ok)
6. Frontend renders results live with color-coded status badges

## Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Max Links | 500 | 1+ (no upper limit) | Maximum number of links to check |
| Recursive | off | — | Follow internal links and check subpages |
| Max Depth | 2 | 1-5 | Maximum crawling depth (when recursive) |
| Same Domain Only | on | — | Only crawl pages on the same domain |
| External Only | off | — | Only check external links |
| Exclude Domains | — | — | Comma-separated domains to skip (supports `*.example.com`) |
| Parallel Requests | 5 | 1-20 | Concurrent link checks |
| Timeout | 30s | 1-120s | Timeout per request |
| Retries | 1 | 0-5 | Retry attempts for failed requests |

## Status Badges

| Color | Status Range | Meaning |
|-------|-------------|---------|
| Green | 200-299 | OK |
| Orange | 300-399 | Redirect |
| Red | 400+ or 0 | Broken / Connection Failed |

## Domain Availability Detection

Every external link triggers a parallel DNS lookup via `dns.promises.lookup()` alongside the HTTP check. The result is classified as one of:

- `resolved` — domain has DNS records
- `available` — NXDOMAIN, the domain is likely unregistered and free to register
- `subdomain-gone` — subdomain NXDOMAIN but the parent domain still resolves
- `timeout` / `error` — DNS lookup failed for other reasons
- `skipped` — internal link or IP literal, not checked

A per-request Promise-valued cache deduplicates concurrent lookups for the same hostname, so many links sharing a host only cost one DNS query. See `server/utils/domain-checker.ts` for the implementation and [ADR-009](../adr/009-dns-domain-availability.md) for the rationale.

## Test the feature

A bundled demo page exercises every domain-check branch. Start the dev server with the localhost-SSRF opt-in:

```
URL_TOOLS_ALLOW_LOCALHOST=1 npm run dev
```

Then open the Link Checker tab, disable *External links only*, and crawl:

```
http://localhost:3000/demo/dead-links.html
```

(Use the port shown in your terminal — may differ from 3000.)

Expected: one **Available** badge (`.invalid` TLD), one **Subdomain missing** badge (`no-such-sub-xyz987.google.com`), and two valid `example.com` links with an empty Domain column.

Without `URL_TOOLS_ALLOW_LOCALHOST=1`, the SSRF guard rejects localhost seed URLs and the crawler reports `0 seed URL(s)`.
