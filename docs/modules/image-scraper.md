# Module: Image-Scraper

## Purpose

Extract all images from web pages, filter them, and optionally download them. Supports various sources (img tags, srcset, background images).

## Features

- **Multi-Source Extraction** — `<img>` tags (src, data-src, data-lazy-src), background images, srcset
- **Format Filter** — JPG, PNG, GIF, WebP, SVG
- **Dimension Filter** — Minimum width and height in pixels
- **Batch Download** — Download images to disk
- **Subfolder Organization** — Optional: one subfolder per source URL
- **Image Preview** — Preview with filename, dimensions, alt text, size
- **Progress Indicator** — Checkmarks for downloaded images

## Data Model

- **Endpoint:** `POST /api/scrape-images`
- **Output:** `output/images/{timestamp}/`
- Details: see [data-model.md](../data-model.md#post-apiscrape-images)

## Data Flow

1. User enters URLs
2. User configures filters (format, dimensions) and download option
3. Server fetches HTML of each URL
4. Cheerio extracts image URLs from various sources
5. Filters are applied (format, dimensions)
6. On download: images are saved in `output/images/{timestamp}/`
7. Result list with preview and statistics

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Download | on | Download images to disk |
| Subfolder per URL | off | Create subfolder per source URL |
| Min. Width | 0 | Minimum width in pixels |
| Min. Height | 0 | Minimum height in pixels |
| Formats | all | JPG, PNG, GIF, WebP, SVG |

## Image Sources

| Source | Selector/Pattern |
|--------|-----------------|
| Standard Images | `<img src="...">` |
| Lazy-Loading | `<img data-src="...">`, `<img data-lazy-src="...">` |
| Srcset | `<img srcset="...">` |
| Background Images | `style="background-image: url(...)"` |

**Ignored:** Data URLs (`data:`), duplicates
