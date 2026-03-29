# Modules

Each feature module has its own documentation. Focus is on **WHAT** and **WHY**, not on implementation details.

## Overview

| Module | Description | Components |
|--------|-------------|------------|
| [HTML-Scraper](html-scraper.md) | Extract HTML from web pages using CSS selectors | `ResultsTable.vue`, `SettingsPanel.vue` |
| [Link-Analyzer](link-analyzer.md) | Analyze links, follow redirect chains, crawl recursively | `ResultsTable.vue`, `SettingsPanel.vue` |
| [SEO-Audit](seo-audit.md) | Calculate SEO score, check meta tags, identify issues | `SeoAudit.vue` |
| [Screenshots](screenshots.md) | Create screenshots and PDFs of web pages | `Screenshots.vue` |
| [Image-Scraper](image-scraper.md) | Extract and download images from web pages | `ImageScraper.vue` |

## Shared Components

These components are used by multiple modules:

| Component | Used by | Purpose |
|-----------|---------|---------|
| `UrlInput.vue` | All modules | URL input, import, filter |
| `RequestSettings.vue` | HTML-Scraper, Link-Analyzer | Timeout, retries, proxy, headers |
| `RecentJobsMenu.vue` | All modules | Access previous results |
| `SitemapParser.vue` | Standalone | Extract sitemap URLs |
