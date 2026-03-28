# Module: Screenshots

## Purpose

Create screenshots and PDFs of web pages via Puppeteer (headless Chrome). Supports various formats, viewports, and batch processing.

## Features

- **Three Formats** — PNG (lossless), JPG (compressed, adjustable quality), PDF (A4)
- **Viewport Presets** — Desktop, 4K, Laptop, Tablet, Mobile (UI uses fixed presets only; the API supports custom dimensions 100-3840px width, 100-4096px height)
- **Full Page** — Capture entire scroll height (PNG/JPG only)
- **Quality Slider** — JPG compression 10-100%
- **Batch Processing** — Multiple URLs sequentially
- **Preview** — Screenshot preview in the browser

## Data Model

- **Endpoint:** `POST /api/screenshot`
- **Output:** `output/screenshots/{timestamp}/`
- Details: see [data-model.md](../data-model.md#post-apiscreenshot)

## Data Flow

1. User enters URLs
2. User selects format, viewport, and options
3. Server starts Puppeteer (headless Chrome, singleton)
4. Per URL: load page (networkidle2), create screenshot/PDF
5. Files are saved in `output/screenshots/{timestamp}/`
6. Result list with preview is displayed

## Viewport Presets

| Preset | Width | Height |
|--------|-------|--------|
| Desktop | 1920 | 1080 |
| 4K | 3840 | 2160 |
| Laptop | 1366 | 768 |
| Tablet | 768 | 1024 |
| Mobile | 375 | 812 |

## Format Details

| Format | Transparency | Adjustable Quality | Notes |
|--------|-------------|-------------------|-------|
| PNG | Yes | No | Lossless, largest files |
| JPG | No | Yes (10-100%) | Compressed, default 80% |
| PDF | — | — | A4, 1cm margins, print-background |

## Notes

- **Puppeteer Singleton:** Browser instance is reused, not restarted per screenshot
- **First Launch:** ~300 MB Chromium download (or pre-installed via Docker)
- **Docker:** Chromium is pre-installed in the Docker image (`/usr/bin/chromium`)
- **JavaScript:** Fully rendered — SPAs are displayed correctly
