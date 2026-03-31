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
