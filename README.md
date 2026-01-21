# HTML/JSON Scraper

A simple, local-only web scraper with a browser-based UI. Built with Nuxt 4.

## Why?

I tried various existing scrapers, but none of them worked the way I needed for my specific use cases. So I built my own.

Is it perfect? No. Is it feature-complete? Definitely not. But it does exactly what I need it to do.

## Features

- **HTML Scraping**: Fetch HTML from multiple URLs in parallel
- **Link Analysis**: Extract and validate all links from a page, including redirect chains
- **CSS Selectors**: Extract specific parts of a page (main content, articles, custom selectors)
- **Multiple Export Formats**: JSON and CSV
- **Sitemap Support**: Automatically detects and parses XML sitemaps
- **Local Storage**: All data stays on your machine

## Installation

```bash
npm install
```

## Usage

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### HTML Mode

1. Enter one or more URLs (one per line or comma-separated)
2. Optionally select a CSS selector to extract specific content
3. Click "Go"
4. Results are automatically saved to the `output/` folder

### Link Mode

1. Enter one or more URLs
2. Enable recursive crawling if needed
3. Configure rate limiting and depth
4. Click "Go"
5. View link status, redirects, and anchor texts

## Output

All scraped data is saved locally in the `output/` directory:

- `{timestamp}_html_files/` - Individual HTML files
- `{timestamp}_html_meta.json` - Metadata for HTML scrapes
- `{timestamp}_links.json` - Link analysis results

## Limitations

- **Localhost only**: This tool is designed to run locally. There's no authentication or rate limiting for the web interface.
- **No JavaScript rendering**: Uses simple fetch, won't work with SPAs that require JS execution.
- **Basic error handling**: It works for my use cases, edge cases might not be covered.

## Feature Requests

This tool is built for my personal needs, but if you have suggestions, feel free to open an issue. I might implement it if it aligns with what I need, or you're welcome to fork and extend it.

## Tech Stack

- [Nuxt 4](https://nuxt.com/) - Vue framework
- [Cheerio](https://cheerio.js.org/) - HTML parsing
- [PapaParse](https://www.papaparse.com/) - CSV generation

## License

MIT
