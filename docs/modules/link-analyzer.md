# Module: Link Analyzer

## Purpose

Extract and analyze all links on a web page — including HTTP status, redirect chains, and classification (internal/external). Results are streamed in real-time via Server-Sent Events ("Screaming Frog" style).

## Features

- **Live Streaming** — Links appear in the table in real-time (SSE)
- **Redirect Chain Tracking** — Complete redirect chains (e.g., "301 -> 301 -> 200")
- **Recursive Crawling** — Follow links and analyze subpages
- **Path Filter** — Include/exclude paths (e.g., only `/de/`, without `/en/`)
- **Rate Limiting** — Configurable requests per second
- **Pause/Resume** — Pause and resume crawling
- **Row Selection** — Select rows and copy as TSV
- **Multi-Export** — JSON, CSV, and/or TXT (URL list)

## Data Model

- **Endpoint:** `POST /api/scrape-links-stream` (SSE)
- **Output:** `output/scraper/{timestamp}_links.{json,csv,txt}`
- Details: see [data-model.md](../data-model.md#post-apiscrape-links-stream-sse)

## Data Flow

1. User enters start URLs
2. User configures crawling settings (depth, max URLs, rate limit)
3. Frontend opens SSE connection to the server
4. Server crawls URLs and streams results as events:
   - `result` — single link result
   - `progress` — progress (done/total)
   - `log` — status messages
5. Frontend renders links live in the table
6. On completion (`done` event): auto-save as JSON/CSV/TXT

## Settings

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Recursive | off | — | Follow links and crawl subpages |
| Max URLs | 100 | 1-10,000 | Maximum number of URLs to check |
| Max Depth | 3 | 1-10 | Maximum crawling depth |
| Same Domain Only | on | — | Only follow internal links |
| Rate Limit | 2/s | 0.1-10 | Requests per second |
| Include Paths | — | — | Comma-separated paths (e.g., `/de/,/blog/`) |
| Exclude Paths | — | — | Paths to exclude |
| URL Filter | — | max. 200 characters | Regex filter for URLs |
| Export Format | CSV | JSON/CSV/both | Output format |

## Statistics Bar

The table displays a statistics bar with:
- Total links, 2xx, 3xx, 4xx, 5xx, errors
- Ratio of internal vs. external
- Color coding by status
