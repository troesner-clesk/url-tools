# URL Tools

A collection of web scraping and analysis tools with a browser-based UI. Built with Nuxt 4.

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
- Extract and validate all links from a page
- Follow redirect chains
- Check link status codes
- View anchor texts

### SEO Audit
- Analyze page titles, meta descriptions, headings
- Check Open Graph and Twitter Card tags
- Identify missing or duplicate meta tags
- Bulk analysis of multiple URLs

### Screenshots & PDF
- Capture full-page or viewport screenshots
- Export as PNG, JPG, or PDF
- Custom viewport dimensions
- Adjustable quality settings

### Image Scraper
- Extract all images from web pages
- Filter by dimensions and format
- Batch download to local folder
- Supports img tags, srcset, and background images

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

All data is saved locally in the `output/` directory:

- `{timestamp}_html_files/` - Individual HTML files
- `{timestamp}_html_meta.json` - Metadata for HTML scrapes
- `{timestamp}_links.json` - Link analysis results
- `screenshots/{timestamp}/` - Screenshot and PDF files
- `images/{timestamp}/` - Downloaded images

## Limitations

- **Localhost only**: Designed to run locally. No authentication for the web interface.
- **No JavaScript rendering** (for scraping): Uses simple fetch for HTML/Link/Image scraping. Screenshots use Puppeteer and do render JavaScript.
- **Basic error handling**: Works for my use cases, edge cases might not be covered.

## Tech Stack

- [Nuxt 4](https://nuxt.com/) - Vue framework
- [Cheerio](https://cheerio.js.org/) - HTML parsing
- [Puppeteer](https://pptr.dev/) - Screenshots and PDF generation
- [PapaParse](https://www.papaparse.com/) - CSV generation

## License

MIT
