# URL Tools

A collection of web scraping and analysis tools with a browser-based UI. Built with Nuxt 4.

## Disclaimer

**Use at your own risk.** This tool is provided as-is, without any warranty. By using it, you agree that:

- You are solely responsible for ensuring you have permission to scrape, crawl, or analyze any target website.
- Downloading content from websites may violate their terms of service or applicable laws.
- Downloaded files (HTML, images, etc.) may contain malicious content — scan them before opening.
- The author assumes no liability for any damages, legal issues, or data loss arising from the use of this tool.

## Why?

I tried various existing tools, but none of them worked the way I needed for my specific use cases. So I built my own.

Is it perfect? No. Is it feature-complete? Definitely not. But it does exactly what I need it to do.

## Features

### HTML Scraping
- Fetch HTML from multiple URLs in parallel
- CSS Selectors to extract specific parts of a page
- Export as JSON or CSV
- Sitemap support (auto-detects XML sitemaps)

### Link Analysis
- Live streaming results (Screaming Frog style) — links appear in the table as they are discovered
- Extract and validate all links from a page
- Follow redirect chains with full status tracking
- Recursive crawling with configurable depth and rate limiting
- Path filters: include/exclude specific URL paths (e.g. only `/de/`, skip `/en/, /fr/`)
- Row selection with copy-to-clipboard
- Export as JSON, CSV, or plain URL list (TXT)

### SEO Audit
- Analyze page titles, meta descriptions, headings
- Check Open Graph and Twitter Card tags
- Identify missing or duplicate meta tags
- Bulk analysis of multiple URLs with scoring (0-100)

### Screenshots & PDF
- Capture full-page or viewport screenshots
- Export as PNG, JPG, or PDF
- Custom viewport dimensions (Desktop, Laptop, Tablet, Mobile presets)
- Adjustable quality settings

### Image Scraper
- Extract all images from web pages
- Filter by dimensions and format
- Batch download to local folder
- Supports img tags, srcset, and background images

### Sitemap Parser
- Fetch and parse XML sitemaps
- Follow sitemap index files recursively
- Extract URL, lastmod, changefreq, priority
- Copy all URLs to clipboard

### Broken Link Checker
- Crawl pages and HEAD-check all links via SSE streaming
- Color-coded status badges (green/yellow/red)
- Filter broken links only
- Detect available domains (unregistered/expired) in outbound links — useful for link audits
- Export broken links as TSV

### Silo / Inbound Link Analyzer
- Find which internal pages link TO a given target URL (inverse of the Link Analyzer)
- Three target modes: single URL, multiple URLs, full site matrix
- Two crawl scopes: recursive from seed URL, or sitemap-driven
- Three result views:
  - **Flat table** — raw source → target rows
  - **Grouped** — per-target inbound count, unique sources, anchor-text distribution
  - **Graph** — force-directed visualization with URL-path hierarchy as layout backbone, actual `<a>` edges overlaid on hover; Obsidian/Seorch-style bursts per URL path
- Graph sidebar: zoom slider, node-size modes, connection visibility, category filters (targets / top-inbound / hubs / orphans), live stats

### UI
- Global right-side log drawer (resizable, collapsible, per-tab logs/progress/current-URL, state persisted in localStorage)
- Dark/Light mode toggle with system preference detection
- Responsive design for mobile devices

## Installation

```bash
npm install
```

## Usage

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Output

All data is saved locally in the `output/` directory inside the project. Set `OUTPUT_DIR` to change the location:

```bash
OUTPUT_DIR=/my/custom/path npm run dev
```

Output structure:

- `scraper/{timestamp}_html_files/` - Individual HTML files
- `scraper/{timestamp}_html_meta.json` - Metadata for HTML scrapes
- `scraper/{timestamp}_links.json` - Link analysis results
- `screenshots/{timestamp}/` - Screenshot and PDF files
- `images/{timestamp}/` - Downloaded images
- `seo-audit/{timestamp}_seo-audit.json` - SEO audit results

## Docker

```bash
# Build and run with docker-compose
docker compose up -d

# Or build manually
docker build -t url-tools .
docker run -p 3000:3000 -v ./output:/app/output url-tools
```

The `output/` directory is mounted as a volume so results persist between container restarts.

## Testing

```bash
npm test            # Run all tests (80 tests)
npm run test:watch  # Watch mode
```

## Limitations

- **Localhost only**: Designed to run locally. No authentication for the web interface.
- **No JavaScript rendering** (for scraping): Uses simple fetch for HTML/Link/Image scraping. Screenshots use Puppeteer and do render JavaScript.
- **Basic error handling**: Works for my use cases, edge cases might not be covered.

## Tech Stack

- [Nuxt 4](https://nuxt.com/) - Vue framework
- [Cheerio](https://cheerio.js.org/) - HTML parsing
- [Puppeteer](https://pptr.dev/) - Screenshots and PDF generation
- [PapaParse](https://www.papaparse.com/) - CSV generation
- [Lucide](https://lucide.dev/) - Icons
- [Vitest](https://vitest.dev/) - Testing

## Documentation

Detailed documentation lives in the [`docs/`](docs/) directory:

- [Architecture Overview](docs/ARCHITECTURE.md) — Tech stack, project structure, data flow
- [Data Model & API Reference](docs/data-model.md) — All endpoints, request/response schemas
- [Architecture Decision Records](docs/adr/) — Why things are built the way they are
- [Modules](docs/modules/) — Feature documentation per module
- [Runbooks](docs/runbooks/) — Deployment, troubleshooting

## License

MIT
