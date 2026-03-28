# ADR-004: Puppeteer for Screenshots and PDF Generation

**Date:** 2025-01-01
**Status:** Accepted

## Context

Screenshots and PDF export require a rendering engine. Alternatives: external APIs (e.g., Screenshotlayer, Urlbox), wkhtmltopdf, Playwright, or Puppeteer.

## Decision

Puppeteer (Headless Chrome) for screenshots (PNG/JPG) and PDF generation.

## Rationale

- **Full browser rendering:** JavaScript is executed — important for SPAs and dynamic pages.
- **No external APIs:** No API keys, no rate limits, no costs, no dependency on third-party providers.
- **Format flexibility:** PNG (lossless), JPG (compressed, adjustable quality), PDF (A4).
- **Viewport control:** Arbitrary resolutions (100-3840px), full-page capture.
- **Stable:** Puppeteer is the most widely used browser automation tool.

## Consequences

**Positive:**
- Pixel-perfect screenshots
- PDF with correct layout
- Works offline (local Chromium)

**Negative:**
- ~300 MB Chromium download on first launch
- Docker image becomes significantly larger due to Chromium dependencies
- Resource-intensive (each screenshot launches a browser page)
- Singleton pattern required to reuse browser instance
