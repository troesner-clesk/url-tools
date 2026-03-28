# Module: HTML Scraper

## Purpose

Extract HTML content from one or more URLs. Supports CSS selectors for filtering specific page sections. Results are saved as JSON and/or CSV.

## Features

- **Batch Scraping** — Process multiple URLs in parallel (configurable, 1-20 concurrent)
- **CSS Selectors** — Extract specific sections (e.g., only `<main>`, `<article>`, `.content`)
- **Selector Presets** — Predefined selectors for common page structures
- **Sitemap Support** — Automatic detection of XML sitemaps
- **Auto-Export** — Results are automatically saved as JSON/CSV/HTML

## Roles & Permissions

Not applicable — no authentication (localhost only).

## Data Model

- **Endpoint:** `POST /api/scrape-html`
- **Output:** `output/scraper/{timestamp}_html_files/` + metadata
- Details: see [data-model.md](../data-model.md#post-apiscrape-html)

## Data Flow

1. User enters URLs (manually, import, or sitemap)
2. User optionally selects a CSS selector (preset or custom)
3. Frontend sends URLs in batches (groups of 5) to the API
4. Server fetches each URL with retry logic (exponential backoff)
5. With CSS selector: Cheerio parses HTML and extracts matches
6. Results appear live in the `ResultsTable`
7. Auto-save: HTML files + metadata CSV/JSON in `output/scraper/`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| CSS Selector | (none) | Selector for filtering the HTML |
| Timeout | 30s | Abort after X seconds |
| Retries | 1 | Retry attempts on failure |
| Parallel | 5 | Concurrent requests |
| Proxy | — | Optional HTTP proxy |
| Custom Headers | — | Additional HTTP headers |

## Selector Presets

| Preset | Selector |
|--------|----------|
| Entire Page | (empty) |
| Main Content | `main` |
| Article | `article` |
| Main or Article | `main, article` |
| Content Class | `.content, #content` |
| Body without Nav | `body > *:not(header):not(footer):not(nav)` |
